// KJC-BUG-0133 — installing IS activating. Field case 2026-08-02: a session
// "installed karajan" (playbook only), skipped the TEXT steps that installed
// hooks/gate, then wrote everything by hand — nothing stopped it. env install
// now performs enforcement itself and prints the method into the session.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../src/rag/vec-store.js", () => ({
  openVecStore: vi.fn(() => ({ close: vi.fn() })),
  projectSlug: vi.fn(() => "proj"),
  getLastIndexedCommit: vi.fn(() => "abc"),
  setLastIndexedCommit: vi.fn(),
  countChunks: vi.fn(() => 1),
  dbPath: vi.fn(() => process.cwd()),
}));
vi.mock("../../src/commands/rag.js", () => ({ ragIndexCommand: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("../../src/environment/playbook.js", () => ({
  installPlaybook: vi.fn(async () => ({ files: ["CLAUDE.md"], target: "claude" })),
  renderPlaybook: vi.fn(() => "# Karajan method (v4)\n…"),
}));
vi.mock("../../src/environment/board-access.js", () => ({
  verifyBoardAccess: vi.fn(() => ({ ok: true, backend: "hu-board", via: "bundled HU Board" })),
}));
vi.mock("../../src/commands/harden.js", () => ({ hardenCommand: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../src/commands/review-gate.js", () => ({ reviewGateCommand: vi.fn(async () => ({ installed: true })) }));

import { envInstallCommand } from "../../src/commands/env.js";
import { hardenCommand } from "../../src/commands/harden.js";
import { reviewGateCommand } from "../../src/commands/review-gate.js";
import { renderPlaybook } from "../../src/environment/playbook.js";

let dir;
beforeEach(() => {
  vi.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-envact-"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("env install — installing IS activating (KJC-BUG-0133)", () => {
  it("runs harden + the verdict gate itself and prints the method into the session", async () => {
    const res = await envInstallCommand({ config: { projectDir: dir, rag: {} }, flags: { rag: false } });
    expect(hardenCommand).toHaveBeenCalledTimes(1);
    expect(hardenCommand.mock.calls[0][0].projectDir).toBe(dir);
    expect(reviewGateCommand.mock.calls[0][0].flags.installGate).toBe(true);
    expect(renderPlaybook).toHaveBeenCalled(); // the method enters THIS conversation
    expect(res.exitCode).toBeUndefined();
  });

  // KJC-BUG-0273: in a repo with history kj left 28 generated files to the agent,
  // whose PR-size rules forbid that commit. What kj generates, kj commits.
  it("commits the contract it generated, on a branch, and leaves the person's edits alone", async () => {
    const { execFileSync } = await import("node:child_process");
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@t");
    git("config", "user.name", "T");
    fs.writeFileSync(path.join(dir, "README.md"), "hi\n");
    git("add", "README.md");
    git("commit", "-qm", "chore: first");
    git("checkout", "-qb", "chore/kj-contract");
    fs.writeFileSync(path.join(dir, "src.js"), "// mine, uncommitted\n");
    const { installPlaybook } = await import("../../src/environment/playbook.js");
    installPlaybook.mockImplementationOnce(async () => {
      fs.mkdirSync(path.join(dir, ".claude", "skills", "kj-run"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".claude", "skills", "kj-run", "SKILL.md"), "# skill\n");
      fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# method\n");
      return { files: ["CLAUDE.md"], target: "claude" };
    });
    await envInstallCommand({ config: { projectDir: dir, rag: {} }, flags: { rag: false } });
    expect(git("log", "-1", "--format=%s").trim()).toMatch(/^chore\(kj\):/);
    expect(git("show", "--name-only", "--format=", "HEAD").trim().split("\n").sort()).toEqual([".claude/skills/kj-run/SKILL.md", "CLAUDE.md"]);
    expect(git("status", "--porcelain")).toMatch(/src\.js/);
  });

  it("without git the install BLOCKS pending — the guarantees do not exist without git", async () => {
    fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
    const res = await envInstallCommand({ config: { projectDir: dir, rag: {} }, flags: { rag: false } });
    expect(res.exitCode).toBe(3);
    expect(hardenCommand).not.toHaveBeenCalled();
  });

  // KJC-BUG-0188: a headless harden never binds an identity (it must not — a
  // blind bind once tied a clone to another session's gh account). The pending
  // step used to be a buried warn, and the Sentinel then denied every git and
  // gh call with no visible link back to it. It blocks at install time instead.
  it("an undeclared identity BLOCKS pending with the exact command", async () => {
    hardenCommand.mockResolvedValueOnce({ ok: true, identityPending: "identity not declared for this clone (non-interactive run) — run: kj identity set --gh me --email me@example.com" });
    const res = await envInstallCommand({ config: { projectDir: dir, rag: {} }, flags: { rag: false } });
    expect(res.exitCode).toBe(3);
    expect(res.pendingBlock).toMatch(/kj identity set --gh me --email me@example\.com/);
  });

  it("--no-enforce is the named escape and enforcement failure blocks pending", async () => {
    await envInstallCommand({ config: { projectDir: dir, rag: {} }, flags: { rag: false, enforce: false } });
    expect(hardenCommand).not.toHaveBeenCalled();
    hardenCommand.mockResolvedValueOnce({ ok: false, error: "boom" });
    const res = await envInstallCommand({ config: { projectDir: dir, rag: {} }, flags: { rag: false } });
    expect(res.exitCode).toBe(3);
  });
});
