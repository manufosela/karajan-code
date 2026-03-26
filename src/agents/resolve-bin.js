import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const cache = new Map();

const isWin = process.platform === "win32";

const SEARCH_DIRS = isWin
  ? [
    path.join(os.homedir(), "AppData", "Roaming", "npm"),
    path.join(os.homedir(), "AppData", "Local", "npm"),
    path.join(os.homedir(), ".opencode", "bin"),
  ]
  : [
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

  // 1. Try system PATH via `which` (Unix) or `where` (Windows)
  try {
    const whichCmd = isWin ? "where" : "which";
    const resolved = execFileSync(whichCmd, [name], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim().split(/\r?\n/)[0];
    if (resolved) {
      cache.set(name, resolved);
      return resolved;
    }
  } catch {
    /* not in PATH */
  }

  // 2. Search known directories
  const dirs = [...SEARCH_DIRS, ...getNvmDirs()];
  const extensions = isWin ? ["", ".cmd", ".exe", ".bat"] : [""];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext);
      if (existsSync(candidate)) {
        cache.set(name, candidate);
        return candidate;
      }
    }
  }

  // 3. Fallback: return name as-is (let execa try PATH)
  cache.set(name, name);
  return name;
}

export function clearBinCache() {
  cache.clear();
}
