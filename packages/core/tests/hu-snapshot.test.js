import { describe, it, expect, vi } from "vitest";
import {
  snapshotRefForHu, createHuSnapshot, hasHuSnapshot,
  restoreHuSnapshot, removeHuSnapshot,
} from "../src/hu-snapshot.js";

describe("@karajan/core/hu-snapshot", () => {
  it("snapshotRefForHu sanitises and prefixes", () => {
    expect(snapshotRefForHu("hu_001")).toBe("refs/kj-snapshots/hu_001");
    expect(snapshotRefForHu("hu/with..weird:chars")).toBe("refs/kj-snapshots/hu_with__weird_chars");
    expect(() => snapshotRefForHu("")).toThrow(/huId/);
  });

  it("createHuSnapshot calls rev-parse then update-ref", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123\n", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    const r = await createHuSnapshot({ projectDir: "/x", huId: "hu_001", runner });
    expect(r).toEqual({ ok: true, ref: "refs/kj-snapshots/hu_001", sha: "abc123" });
  });

  it("hasHuSnapshot returns sha when ref exists", async () => {
    const runner = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "deadbeef\n", stderr: "" });
    expect(await hasHuSnapshot({ projectDir: "/x", huId: "h", runner })).toEqual({ ok: true, sha: "deadbeef" });
  });

  it("restoreHuSnapshot reports missing snapshot", async () => {
    const runner = vi.fn().mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    const r = await restoreHuSnapshot({ projectDir: "/x", huId: "missing", runner });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no encontrado/);
  });

  it("removeHuSnapshot is idempotent (git -d returns 0 even if absent)", async () => {
    const runner = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const r = await removeHuSnapshot({ projectDir: "/x", huId: "absent", runner });
    expect(r.ok).toBe(true);
  });
});
