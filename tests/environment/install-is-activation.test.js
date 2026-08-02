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

  it("without git the install BLOCKS pending — the guarantees do not exist without git", async () => {
    fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
    const res = await envInstallCommand({ config: { projectDir: dir, rag: {} }, flags: { rag: false } });
    expect(res.exitCode).toBe(3);
    expect(hardenCommand).not.toHaveBeenCalled();
  });

  it("--no-enforce is the named escape and enforcement failure blocks pending", async () => {
    await envInstallCommand({ config: { projectDir: dir, rag: {} }, flags: { rag: false, enforce: false } });
    expect(hardenCommand).not.toHaveBeenCalled();
    hardenCommand.mockResolvedValueOnce({ ok: false, error: "boom" });
    const res = await envInstallCommand({ config: { projectDir: dir, rag: {} }, flags: { rag: false } });
    expect(res.exitCode).toBe(3);
  });
});
