// detectAiTrash + installAiTrashHook tests (KJC-TSK-0391).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/process.js", () => ({ runCommand: vi.fn() }));

import { runCommand } from "../../src/utils/process.js";
import { detectAiTrash, installAiTrashHook } from "../../src/utils/ai-trash.js";

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

describe("detectAiTrash", () => {
  beforeEach(() => runCommand.mockReset());

  it("returns available when kj-trash --help exits 0", async () => {
    runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "usage: kj-trash ...", stderr: "" });
    const res = await detectAiTrash();
    expect(res.available).toBe(true);
  });

  it("returns available when kj-trash --help exits 2 (help-as-error idiom)", async () => {
    runCommand.mockResolvedValueOnce({ exitCode: 2, stdout: "", stderr: "" });
    const res = await detectAiTrash();
    expect(res.available).toBe(true);
  });

  it("returns unavailable when runCommand rejects (binary not on PATH)", async () => {
    runCommand.mockRejectedValueOnce(new Error("ENOENT"));
    const res = await detectAiTrash();
    expect(res.available).toBe(false);
    expect(res.version).toBeNull();
  });
});

describe("installAiTrashHook", () => {
  beforeEach(() => runCommand.mockReset());

  it("reports ok+mutated when stdout indicates fresh install", async () => {
    runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "kj-trash: installed -> /home/u/.claude/settings.json\n", stderr: "" });
    const res = await installAiTrashHook(silentLogger());
    expect(res.ok).toBe(true);
    expect(res.mutated).toBe(true);
  });

  it("reports ok+not-mutated when hook already present (idempotent)", async () => {
    runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "kj-trash: already installed -> /home/u/.claude/settings.json\n", stderr: "" });
    const res = await installAiTrashHook(silentLogger());
    expect(res.ok).toBe(true);
    expect(res.mutated).toBe(false);
  });

  it("reports failure when kj-trash exits non-zero", async () => {
    runCommand.mockResolvedValueOnce({ exitCode: 2, stdout: "", stderr: "kj-trash: install requires --claude-code\n" });
    const res = await installAiTrashHook(silentLogger());
    expect(res.ok).toBe(false);
    expect(res.error).toContain("--claude-code");
  });

  it("reports failure when runCommand throws (binary missing mid-install)", async () => {
    runCommand.mockRejectedValueOnce(new Error("ENOENT: kj-trash"));
    const res = await installAiTrashHook(silentLogger());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ENOENT/);
  });
});
