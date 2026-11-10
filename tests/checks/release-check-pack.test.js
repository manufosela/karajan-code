// HU-3728 — the pack privacy check must fail closed: a broken `npm pack`
// (non-zero exit, or no files listed) can never read as "clean".
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pack = vi.hoisted(() => ({ result: null }));
vi.mock("../../src/utils/process.js", () => ({
  runCommand: async (cmd) => (cmd === "npm" ? pack.result : { exitCode: 0, stdout: "", stderr: "" })
}));

const { runReleaseCheck } = await import("../../src/checks/release-check.js");

let dir;
const packCheck = async () => (await runReleaseCheck({ projectDir: dir, config: {} })).checks.find((c) => c.name === "pack-privacy");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-relpack-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo", version: "1.2.0" }));
  fs.writeFileSync(path.join(dir, "index.js"), "export const a = 1;\n");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("pack-privacy fails closed", () => {
  it("is red with the exit code when npm pack exits non-zero", async () => {
    pack.result = { exitCode: 1, stdout: "", stderr: "boom" };
    const c = await packCheck();
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("npm pack exited 1");
  });

  it("is red when npm pack lists no files", async () => {
    pack.result = { exitCode: 0, stdout: "[]", stderr: "" };
    const c = await packCheck();
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("npm pack listed no files");
  });

  it("stays green for a normal pack", async () => {
    pack.result = { exitCode: 0, stdout: JSON.stringify([{ files: [{ path: "index.js" }] }]), stderr: "" };
    const c = await packCheck();
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("1 publishable file(s) clean");
  });
});
