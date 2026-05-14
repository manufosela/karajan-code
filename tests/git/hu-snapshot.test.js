import { describe, it, expect, vi } from "vitest";
import {
  snapshotRefForHu, createHuSnapshot, hasHuSnapshot,
  restoreHuSnapshot, removeHuSnapshot,
} from "../../src/git/hu-snapshot.js";

// KJC-TSK-0408: snapshots git per-HU. Tests con runner mock — no
// necesitan un repo git real.

describe("snapshotRefForHu", () => {
  it("genera ref bajo refs/kj-snapshots/", () => {
    expect(snapshotRefForHu("hu_001")).toBe("refs/kj-snapshots/hu_001");
  });
  it("sanitiza caracteres no válidos para git refs", () => {
    expect(snapshotRefForHu("hu/with..weird:chars")).toBe("refs/kj-snapshots/hu_with__weird_chars");
  });
  it("trunca a 80 chars el segmento del HU", () => {
    const long = "x".repeat(200);
    const r = snapshotRefForHu(long);
    expect(r.length).toBeLessThanOrEqual("refs/kj-snapshots/".length + 80);
  });
  it("falla con huId vacío", () => {
    expect(() => snapshotRefForHu("")).toThrow(/huId/);
    expect(() => snapshotRefForHu(null)).toThrow(/huId/);
  });
});

const okRun = (impl) => vi.fn(impl);

describe("createHuSnapshot", () => {
  it("rev-parse + update-ref → ok con sha del HEAD", async () => {
    const runner = okRun((args) => {
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { exitCode: 0, stdout: "abc123def\n", stderr: "" };
      if (args[0] === "update-ref") return { exitCode: 0, stdout: "", stderr: "" };
      return { exitCode: 1, stderr: "unexpected" };
    });
    const r = await createHuSnapshot({ projectDir: "/x", huId: "hu_001", runner });
    expect(r.ok).toBe(true);
    expect(r.ref).toBe("refs/kj-snapshots/hu_001");
    expect(r.sha).toBe("abc123def");
    // update-ref llamado con el ref + sha
    expect(runner).toHaveBeenCalledWith(["update-ref", "refs/kj-snapshots/hu_001", "abc123def"], expect.any(Object));
  });

  it("rev-parse falla → ok:false con error", async () => {
    const runner = vi.fn().mockResolvedValue({ exitCode: 128, stdout: "", stderr: "not a git repo" });
    const r = await createHuSnapshot({ projectDir: "/x", huId: "hu_001", runner });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rev-parse/);
  });

  it("update-ref falla → ok:false con error", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "abc\n", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "permission denied" });
    const r = await createHuSnapshot({ projectDir: "/x", huId: "hu_001", runner });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/update-ref/);
  });
});

describe("hasHuSnapshot", () => {
  it("ref existe → ok:true + sha", async () => {
    const runner = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "abc123\n", stderr: "" });
    const r = await hasHuSnapshot({ projectDir: "/x", huId: "hu_001", runner });
    expect(r).toEqual({ ok: true, sha: "abc123" });
  });
  it("ref no existe → ok:false", async () => {
    const runner = vi.fn().mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    const r = await hasHuSnapshot({ projectDir: "/x", huId: "hu_001", runner });
    expect(r.ok).toBe(false);
  });
});

describe("restoreHuSnapshot", () => {
  it("snapshot existe + reset OK → ok:true con sha", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123\n", stderr: "" }) // hasHuSnapshot
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });        // reset --hard
    const r = await restoreHuSnapshot({ projectDir: "/x", huId: "hu_001", runner });
    expect(r.ok).toBe(true);
    expect(r.sha).toBe("abc123");
  });
  it("snapshot no existe → ok:false", async () => {
    const runner = vi.fn().mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    const r = await restoreHuSnapshot({ projectDir: "/x", huId: "hu_001", runner });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no encontrado/);
  });
  it("reset falla → ok:false", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123\n", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "merge in progress" });
    const r = await restoreHuSnapshot({ projectDir: "/x", huId: "hu_001", runner });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/reset/);
  });
});

describe("removeHuSnapshot", () => {
  it("ok → update-ref -d invocado y ok:true", async () => {
    const runner = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const r = await removeHuSnapshot({ projectDir: "/x", huId: "hu_001", runner });
    expect(r.ok).toBe(true);
    expect(runner).toHaveBeenCalledWith(["update-ref", "-d", "refs/kj-snapshots/hu_001"], expect.any(Object));
  });
  it("idempotente: ref no existía → todavía ok:true (git devuelve 0)", async () => {
    const runner = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const r = await removeHuSnapshot({ projectDir: "/x", huId: "missing", runner });
    expect(r.ok).toBe(true);
  });
});
