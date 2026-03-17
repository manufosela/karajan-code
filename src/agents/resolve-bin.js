import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const cache = new Map();

const SEARCH_DIRS = [
  "/opt/node/bin",
  path.join(os.homedir(), ".npm-global", "bin"),
  "/usr/local/bin",
  path.join(os.homedir(), ".local", "bin"),
  path.join(os.homedir(), ".opencode", "bin"),
];

function getNvmDirs() {
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  const versionsDir = path.join(nvmDir, "versions", "node");
  try {
    return readdirSync(versionsDir).map(v => path.join(versionsDir, v, "bin"));
  } catch {
    return [];
  }
}

export function resolveBin(name) {
  if (cache.has(name)) return cache.get(name);

  // 1. Try system PATH via `which`
  try {
    const resolved = execFileSync("which", [name], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (resolved) {
      cache.set(name, resolved);
      return resolved;
    }
  } catch {
    /* not in PATH */
  }

  // 2. Search known directories
  const dirs = [...SEARCH_DIRS, ...getNvmDirs()];
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) {
      cache.set(name, candidate);
      return candidate;
    }
  }

  // 3. Fallback: return name as-is (let execa try PATH)
  cache.set(name, name);
  return name;
}

export function clearBinCache() {
  cache.clear();
}
