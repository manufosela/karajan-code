import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInstallCommand, downloadBinary, binDir } from "../../src/utils/tool-installer.js";

// KJC-TSK-0606 — install-tools executor primitives:
//  · runInstallCommand: captured (non-interactive) vs tty-inherited (sudo) execution.
//  · downloadBinary: fetch → temp file → chmod +x → atomic rename into ~/.local/bin.

const NODE = process.execPath;

describe("runInstallCommand — non-interactive (captured)", () => {
  it("runs a command and captures stdout on success", async () => {
    const r = await runInstallCommand(`${NODE} -e console.log('ready')`);
    expect(r.ok).toBe(true);
    expect(r.stdout).toMatch(/ready/);
  });

  it("reports failure for a non-existent binary", async () => {
    const r = await runInstallCommand("kj-nonexistent-binary-xyz --version");
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe("runInstallCommand — interactive (tty inherited, for sudo)", () => {
  it("resolves ok when the child exits 0", async () => {
    const r = await runInstallCommand(`${NODE} -e process.exit(0)`, { interactive: true });
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
  });

  it("resolves not-ok with the exit code when the child fails", async () => {
    const r = await runInstallCommand(`${NODE} -e process.exit(3)`, { interactive: true });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(3);
  });

  it("reports an error when the binary cannot be spawned", async () => {
    const r = await runInstallCommand("kj-nonexistent-binary-xyz", { interactive: true });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe("binDir", () => {
  it("points at ~/.local/bin", () => {
    expect(binDir()).toBe(path.join(os.homedir(), ".local", "bin"));
  });
});

describe("downloadBinary", () => {
  let tmpDir;
  const realFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = realFetch;
    if (tmpDir) { await fs.rm(tmpDir, { recursive: true, force: true }); tmpDir = null; }
  });

  it("downloads, makes executable and places the binary", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-tool-"));
    const body = "#!/bin/sh\necho hi\n";
    globalThis.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(body).buffer });

    const r = await downloadBinary({ url: "https://example.test/osv-scanner", name: "osv-scanner", dir: tmpDir });
    expect(r.ok).toBe(true);
    expect(r.dest).toBe(path.join(tmpDir, "osv-scanner"));

    const content = await fs.readFile(r.dest, "utf8");
    expect(content).toBe(body);
    const mode = (await fs.stat(r.dest)).mode;
    expect(mode & 0o111).toBeTruthy(); // executable bits set
  });

  it("reports failure on a non-2xx response", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-tool-"));
    globalThis.fetch = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });

    const r = await downloadBinary({ url: "https://example.test/missing", name: "missing", dir: tmpDir });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/404/);
  });

  it("leaves no partial file behind when the download fails", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-tool-"));
    globalThis.fetch = async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) });

    await downloadBinary({ url: "https://example.test/x", name: "x", dir: tmpDir });
    const entries = await fs.readdir(tmpDir);
    expect(entries).toEqual([]);
  });
});
