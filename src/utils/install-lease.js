import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LEASE_DIR = ".kj-running";

/** Real path of the package root, so a symlinked kj names the actual copy. */
export function installRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return fs.realpathSync(path.resolve(here, "../.."));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function removeStale(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const pid = Number(entry);
    if (Number.isInteger(pid) && pid > 0 && !isAlive(pid)) {
      fs.rmSync(path.join(dir, entry), { force: true });
    }
  }
}

/**
 * Declare, inside the install this process runs from, that it is alive
 * (KJC-BUG-0531): a cron that replaces installs deletes a folder only when
 * no pid file in it belongs to a live process. Best effort, never throws,
 * never writes to stdout (it is the MCP stdio channel).
 */
export function holdInstall({
  root = installRoot(),
  pid = process.pid,
  name,
  onExit = (fn) => process.on("exit", fn)
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const dir = path.join(root, LEASE_DIR);
  const file = path.join(dir, String(pid));
  try {
    fs.mkdirSync(dir, { recursive: true });
    removeStale(dir);
    fs.writeFileSync(file, `${JSON.stringify({ pid, name, startedAt: new Date().toISOString() })}\n`);
    onExit(() => fs.rmSync(file, { force: true }));
  } catch (error) {
    process.stderr.write(`[kj] install lease not held: ${error.code || error.message}\n`);
  }
}
