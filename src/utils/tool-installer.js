// Executor primitives for `kj install-tools` (KJC-TSK-0606).
//
// Two ways to run an install step:
//  · runInstallCommand(cmd)                 — captured: stdout/stderr collected,
//                                             for non-privileged commands.
//  · runInstallCommand(cmd, {interactive})  — tty inherited: the child owns the
//                                             terminal so `sudo` prompts the user
//                                             directly. kj NEVER sees the password.
//
// And a downloader for tools shipped as a single static binary (osv-scanner,
// semgrep) when no package manager is available: fetch → temp file → chmod +x →
// atomic rename into ~/.local/bin. On any failure it leaves no partial file.

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

/** Directory where downloaded standalone binaries are placed. */
export function binDir() {
  return path.join(os.homedir(), ".local", "bin");
}

/**
 * Run an install command. Commands here are simple (no nested quoting), so we
 * tokenize on whitespace.
 *
 * @param {string} command
 * @param {{ interactive?: boolean }} [opts]
 *   interactive → inherit the parent's stdio so sudo can prompt for the password
 *   on the user's own terminal; kj never captures or logs it.
 */
export async function runInstallCommand(command, opts = {}) {
  const [bin, ...args] = command.split(/\s+/);
  if (opts.interactive) return runInherited(bin, args);
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, error: err?.shortMessage || err?.message || String(err), stderr: err?.stderr };
  }
}

function runInherited(bin, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: "inherit", timeout: 600_000 });
    } catch (err) {
      resolve({ ok: false, error: err?.message || String(err) });
      return;
    }
    child.on("error", (err) => resolve({ ok: false, error: err?.message || String(err) }));
    child.on("close", (code) => resolve({ ok: code === 0, code }));
  });
}

/**
 * Download a single static binary and place it (executable) into `dir`.
 * Writes to a temp file first and renames atomically; on any failure the temp
 * file is removed so no partial artifact is left behind.
 *
 * @param {{ url: string, name: string, dir?: string }} args
 */
export async function downloadBinary({ url, name, dir = binDir() }) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    return { ok: false, error: `download failed: ${err?.message || String(err)}` };
  }
  if (!res.ok) return { ok: false, error: `download failed: HTTP ${res.status}` };

  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, name);
  const tmp = path.join(dir, `.${name}.download`);
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(tmp, buf);
    await fs.chmod(tmp, 0o755);
    await fs.rename(tmp, dest);
    return { ok: true, dest };
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    return { ok: false, error: `install failed: ${err?.message || String(err)}` };
  }
}
