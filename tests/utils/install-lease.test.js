import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { holdInstall, installRoot } from "../../src/utils/install-lease.js";

describe("install-lease (KJC-BUG-0531)", () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "kj-lease-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it("installRoot is the real package root", () => {
    expect(fs.existsSync(path.join(installRoot(), "package.json"))).toBe(true);
  });

  it("writes the pid file and removes it when the exit hook runs", () => {
    let exitHook;
    holdInstall({ root, pid: process.pid, name: "x-mcp", onExit: (fn) => { exitHook = fn; } });
    const file = path.join(root, ".kj-running", String(process.pid));
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(data).toMatchObject({ pid: process.pid, name: "x-mcp" });
    expect(typeof data.startedAt).toBe("string");
    exitHook();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("removes stale pid files of dead processes and keeps live ones", () => {
    const dir = path.join(root, ".kj-running");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "2147483646"), "{}");
    fs.writeFileSync(path.join(dir, String(process.ppid)), "{}");
    holdInstall({ root, pid: process.pid, name: "x", onExit: () => {} });
    expect(fs.existsSync(path.join(dir, "2147483646"))).toBe(false);
    expect(fs.existsSync(path.join(dir, String(process.ppid)))).toBe(true);
  });

  it("does not throw when the root is not writable", () => {
    const blocker = path.join(root, "file");
    fs.writeFileSync(blocker, "x");
    expect(() => holdInstall({ root: path.join(blocker, "sub"), name: "x", onExit: () => {} })).not.toThrow();
  });

  it("rejects a non-integer pid without writing", () => {
    for (const pid of [1.5, -3, 0, "../x", NaN]) {
      holdInstall({ root, pid, name: "x", onExit: () => {} });
    }
    expect(fs.existsSync(path.join(root, ".kj-running"))).toBe(false);
  });
});
