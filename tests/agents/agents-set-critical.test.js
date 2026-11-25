// HU-4905 (KJC-BUG-0660, found by the whole-diff review of #4896): the panel decides who reviews
// and who arbitrates, so changing it changes who governs. At `critical` kj agents set is signed by
// the phone like the other acts that change who governs, and what the phone signs is the file the
// change writes: the repo's .karajan/kj.config.yml, or ~/.karajan/kj.config.yml with --global.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dirs = vi.hoisted(() => ({ project: "", home: "" }));
vi.mock("../../src/utils/agent-detect.js", () => ({
  checkBinary: vi.fn(async () => ({ ok: false })),
  KNOWN_AGENTS: [{ name: "claude" }, { name: "codex" }, { name: "agy" }],
}));
vi.mock("../../src/session/runtime-overrides.js", () => ({ setRuntimeOverride: vi.fn(), getRuntimeOverrides: vi.fn(() => ({})), clearRuntimeOverrides: vi.fn() }));
vi.mock("../../src/config.js", async (importOriginal) => ({
  ...(await importOriginal()),
  loadGlobalConfigFile: vi.fn(async () => ({})),
  writeConfig: vi.fn(),
  getConfigPath: vi.fn(() => `${dirs.home}/kj.config.yml`),
  loadProjectConfig: vi.fn(async () => ({})),
  getProjectConfigPath: vi.fn(() => `${dirs.project}/.karajan/kj.config.yml`),
  resolveRole: vi.fn(() => ({ provider: "claude", model: null })),
}));

const { setAgent } = await import("../../src/commands/agents.js");
const { writeConfig } = await import("../../src/config.js");
const { CRITICAL_ACTS } = await import("../../src/harden/human-act.js");
const { setSignedLevel } = await import("../_fixtures/set-normal-level.js");

dirs.project = mkdtempSync(join(tmpdir(), "kj-agents-crit-"));
dirs.home = mkdtempSync(join(tmpdir(), "kj-agents-crit-home-"));
afterAll(() => {
  rmSync(dirs.project, { recursive: true, force: true });
  rmSync(dirs.home, { recursive: true, force: true });
});

const bash = { readProc: () => ({ ppid: 1, cmd: "bash" }) };
const asked = [];
const phone = (ok = true) => ({ enrolled: () => true, request: async (req) => { asked.push(req); return ok ? { ok: true, signer: "k", signature: "s", block: { signer: "k", signature: "s" } } : { ok: false, reason: "declined" }; } });
const human = (extra = {}) => ({ env: {}, tty: true, ancestry: bash, confirm: (n) => n, home: dirs.home, logger: { info() {}, warn() {} }, phone: phone(), ...extra });

describe("kj agents set at critical (HU-4905)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asked.length = 0;
    setSignedLevel(dirs.project, "critical");
  });

  it("is one of the acts that change who governs", () => {
    expect(CRITICAL_ACTS.has("agents-set")).toBe(true);
  });

  it("asks the phone at critical, signing the repo's config file, then writes", async () => {
    await setAgent("reviewer", "codex", { deps: human() });
    expect(asked).toHaveLength(1);
    expect(asked[0].files.map((f) => f.file)).toEqual([".karajan/kj.config.yml"]);
    expect(writeConfig).toHaveBeenCalledTimes(1);
  });

  it("with --global the phone signs the shared config file, not the repo's", async () => {
    await setAgent("solomon", "agy", { global: true, deps: human() });
    expect(asked).toHaveLength(1);
    expect(asked[0].files.map((f) => f.file)).toEqual(["~/.karajan/kj.config.yml"]);
    expect(writeConfig).toHaveBeenCalledWith(`${dirs.home}/kj.config.yml`, expect.anything());
  });

  it("a declined signature writes nothing", async () => {
    await expect(setAgent("reviewer", "codex", { deps: human({ phone: phone(false) }) })).rejects.toThrow();
    expect(writeConfig).not.toHaveBeenCalled();
  });
});
