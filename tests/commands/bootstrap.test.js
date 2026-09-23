// BOOT-A (KJC-TSK-0857, epic KJC-PCS-0088, cold-start ADR) — one command from
// an empty directory to a project under the method. It orchestrates what
// already exists, in the order that works, and repeats nothing: the whole
// point is that nobody has to remember the order or fight a gate they just
// installed. Everything injectable, no real installs in tests.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootstrapCommand } from "../../src/commands/bootstrap.js";

let dir;
const logger = () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  all: function () { return [...this.info.mock.calls, ...this.warn.mock.calls, ...this.error.mock.calls].flat().join("\n"); },
});
const run = (over = {}) => {
  const deps = { init: vi.fn(async () => ({})), env: vi.fn(async () => ({})), ...over.deps };
  const log = over.logger ?? logger();
  return bootstrapCommand({ config: { projectDir: dir }, logger: log, flags: over.flags ?? {}, deps })
    .then((result) => ({ result, deps, log }));
};

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-boot-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("kj bootstrap", () => {
  it("turns an empty directory into a repo under the method, in order", async () => {
    const { result, deps } = await run();
    expect(fs.existsSync(path.join(dir, ".git"))).toBe(true);
    expect(deps.init).toHaveBeenCalledOnce();
    expect(deps.env).toHaveBeenCalledOnce();
    expect(result.steps.map((s) => s.name)).toEqual(["git", "config", "method"]);
    expect(result.steps.every((s) => s.status === "done")).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("repeats nothing: a second run reports what was already there", async () => {
    await run();
    fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "kj.config.yml"), "coder: claude\n");
    fs.writeFileSync(path.join(dir, ".karajan", "review-gate"), "x");
    const { result, deps } = await run();
    expect(deps.init).not.toHaveBeenCalled();
    expect(deps.env).not.toHaveBeenCalled();
    expect(result.steps.map((s) => s.status)).toEqual(["already", "already", "already"]);
    expect(result.ok).toBe(true);
  });

  it("a step that needs the person's hands stops the sequence, and says which", async () => {
    const { result, deps, log } = await run({ deps: { env: vi.fn(async () => ({ exitCode: 3 })) } });
    expect(deps.init).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    expect(result.pending).toBe("method");
    expect(log.all()).toMatch(/método/);
  });

  it("without git it stops instead of pretending — the guarantees live in git hooks", async () => {
    const { result, deps } = await run({ deps: { gitFn: () => { throw new Error("git: command not found"); } } });
    expect(result.ok).toBe(false);
    expect(result.pending).toBe("git");
    expect(deps.init).not.toHaveBeenCalled();
  });
});
