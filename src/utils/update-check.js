import fs from "node:fs/promises";
import path from "node:path";
import { getKarajanHome } from "./paths.js";

const CACHE_FILE = "update-check.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PACKAGE_NAME = "karajan-code";

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
    console.log(`\n  Update available: v${result.current} → v${result.latest}`);
    console.log(`  Run: npm install -g ${PACKAGE_NAME}\n`);
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
