// MGL-A (KJC-TSK-0808, epic KJC-PCS-0084) — `kj go`: the muggle launcher.
// One command: detect agents, ask AT MOST one question, prepare the project
// silently, open the board, and hand the person a conversation that already
// knows the method. Everything injectable — no real processes in tests.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { goCommand, detectMaggleAgents } from "../../src/commands/go.js";

describe("detectMaggleAgents", () => {
  it("installed × authenticated from cheap local checks — no process is spawned for auth", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-go-home-"));
    try {
      fs.writeFileSync(path.join(home, ".claude.json"), "{}");
      const out = await detectMaggleAgents({ home, checkBin: async (name) => ({ ok: name === "claude" }) });
      const claude = out.find((a) => a.name === "claude");
      const codex = out.find((a) => a.name === "codex");
      expect(claude).toMatchObject({ installed: true, authenticated: true });
      expect(codex).toMatchObject({ installed: false, authenticated: false });
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});

let dir;
const logger = () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  all: function () { return [...this.info.mock.calls, ...this.warn.mock.calls, ...this.error.mock.calls].flat().join("\n"); },
});
const agent = (name, over = {}) => ({ name, label: name, installed: true, authenticated: true, install: `npm install -g ${name}-cli`, login: `${name} login`, ...over });
const run = (over = {}) => {
  const deps = {
    detect: async () => [agent("claude"), agent("codex")],
    ask: vi.fn(async () => "claude"),
    prepare: vi.fn(async () => {}),
    board: vi.fn(async () => {}),
    launch: vi.fn(async () => 0),
    ...over.deps,
  };
  return goCommand({ config: { projectDir: dir, ...over.config }, logger: over.logger ?? logger(), flags: {}, deps }).then((code) => ({ code, deps }));
};

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-go-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("kj go", () => {
  it("two ready agents: exactly ONE question, and the answer picks the session", async () => {
    const { code, deps } = await run();
    expect(code).toBe(0);
    expect(deps.ask).toHaveBeenCalledOnce();
    expect(deps.launch.mock.calls[0][0].name).toBe("claude");
  });
  it("one ready agent: zero questions — it is used and said", async () => {
    const log = logger();
    const { deps } = await run({ logger: log, deps: { detect: async () => [agent("codex"), agent("claude", { installed: false, authenticated: false })] } });
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.launch.mock.calls[0][0].name).toBe("codex");
    expect(log.all()).toMatch(/codex/i);
  });
  it("no agent, or no login: never an error dump — the exact install/login commands and the honest note that the account is theirs", async () => {
    const none = logger();
    const r1 = await run({ logger: none, deps: { detect: async () => [agent("claude", { installed: false, authenticated: false }), agent("codex", { installed: false, authenticated: false })] } });
    expect(r1.code).toBe(1);
    expect(r1.deps.launch).not.toHaveBeenCalled();
    expect(none.all()).toMatch(/npm install -g claude-cli/);
    expect(none.all()).toMatch(/cuenta/i); // la cuenta y el login son suyos
    const noAuth = logger();
    const r2 = await run({ logger: noAuth, deps: { detect: async () => [agent("claude", { authenticated: false })] } });
    expect(r2.code).toBe(1);
    expect(noAuth.all()).toMatch(/claude login/);
  });
  it("an unprepared project is prepared silently; a prepared one is NEVER re-asked", async () => {
    const first = await run({ deps: { detect: async () => [agent("claude")] } });
    expect(first.deps.prepare).toHaveBeenCalledOnce();
    fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "review-gate"), "x");
    const second = await run({ deps: { detect: async () => [agent("claude")] } });
    expect(second.deps.prepare).not.toHaveBeenCalled();
  });
  it("the board opens alongside — unless the project turned it off (hu_board.enabled false is respected)", async () => {
    const on = await run({ deps: { detect: async () => [agent("claude")] } });
    expect(on.deps.board).toHaveBeenCalledOnce();
    const off = await run({ config: { hu_board: { enabled: false } }, deps: { detect: async () => [agent("claude")] } });
    expect(off.deps.board).not.toHaveBeenCalled();
  });
  it("the launcher gets a non-empty prompt in plain language — the session is born knowing whom it talks to", async () => {
    const { deps } = await run({ deps: { detect: async () => [agent("claude")] } });
    const prompt = deps.launch.mock.calls[0][1];
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toMatch(/llano/i);
  });
  it("a board failure never stops the launch — said, not fatal", async () => {
    const log = logger();
    const { code, deps } = await run({ logger: log, deps: { detect: async () => [agent("claude")], board: vi.fn(async () => { throw new Error("port busy"); }) } });
    expect(code).toBe(0);
    expect(deps.launch).toHaveBeenCalledOnce();
    expect(log.all()).toMatch(/port busy/);
  });
});
