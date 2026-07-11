import fs from "node:fs/promises";
import path from "node:path";
import { isSea } from "node:sea";
import { getKarajanHome } from "./paths.js";

const CACHE_FILE = "update-check.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PACKAGE_NAME = "karajan-code";

const RAW_BASE = "https://raw.githubusercontent.com/manufosela/karajan-code/main/scripts";
export const INSTALL_SH_URL = `${RAW_BASE}/install-binary.sh`;
export const INSTALL_PS1_URL = `${RAW_BASE}/install-binary.ps1`;

/**
 * Build the "how to update" line for the detected install channel.
 * Pure and testable — no I/O.
 * @param {{channel: "sea"|"npm"|"unknown", platform?: string}} opts
 */
export function updateInstruction({ channel, platform = process.platform }) {
  if (channel === "sea") {
    return platform === "win32"
      ? `Re-run the installer: irm ${INSTALL_PS1_URL} | iex`
      : `Re-run the installer: curl -fsSL ${INSTALL_SH_URL} | sh`;
  }
  if (channel === "npm") {
    return `Run: npm install -g ${PACKAGE_NAME}`;
  }
  // Channel unknown — offer both paths, never silently pick a wrong one.
  return `Update: npm install -g ${PACKAGE_NAME}  (or re-run the binary installer — see README)`;
}

/**
 * Detect how this kj was installed: "sea" (standalone binary) or "npm"
 * (global install / source tree). Falls back to "npm" if isSea() throws.
 */
export function detectInstallChannel() {
  try {
    return isSea() ? "sea" : "npm";
  } catch {
    // isSea() unexpectedly threw ⇒ treat as npm / source tree, never block.
    return "npm";
  }
}

/**
 * Check npm for a newer version. Non-blocking, cached for 24h.
 * Returns { updateAvailable, latest, current } or null if check fails/cached.
 */
export async function checkForUpdate(currentVersion) {
  try {
    const cachePath = path.join(getKarajanHome(), CACHE_FILE);

    // Check cache first
    try {
      const raw = await fs.readFile(cachePath, "utf8");
      const cache = JSON.parse(raw);
      if (cache.checkedAt && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
        if (!cache.latest || cache.latest === currentVersion) return null;
        // Only show update if latest is actually NEWER than current
        if (compareVersions(cache.latest, currentVersion) > 0) {
          return { updateAvailable: true, latest: cache.latest, current: currentVersion };
        }
        return null;
      }
    } catch { /* no cache or expired */ }

    // Fetch from npm (timeout 3s, don't block)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: controller.signal,
      headers: { "Accept": "application/json" },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const latest = data.version;

    // Save cache
    await fs.mkdir(getKarajanHome(), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify({ latest, checkedAt: Date.now() }), "utf8");

    if (latest === currentVersion) return null;
    if (compareVersions(latest, currentVersion) > 0) {
      return { updateAvailable: true, latest, current: currentVersion };
    }
    return null;
  } catch {
    return null; // Network error, offline, etc. Never block.
  }
}

/**
 * Print update notice if available. Call at CLI startup, non-blocking.
 */
export async function printUpdateNotice(currentVersion) {
  const result = await checkForUpdate(currentVersion);
  if (result?.updateAvailable) {
    const channel = detectInstallChannel();
    console.log(`\n  Update available: v${result.current} → v${result.latest}`);
    console.log(`  ${updateInstruction({ channel })}\n`);
  }
}

/** Simple semver compare: returns >0 if a > b, <0 if a < b, 0 if equal */
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}
