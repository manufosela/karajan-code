import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isSea } from "node:sea";
import { getKarajanHome } from "./paths.js";

const CACHE_FILE = "update-check.json";
// KJC-TSK-0690: 6h — kj can ship several releases a day; a session should
// not work a full day blind. KJ_NO_UPDATE_CHECK=1 opts out (CI).
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PACKAGE_NAME = "karajan-code";
const CHANGELOG_URL = "https://raw.githubusercontent.com/manufosela/karajan-code/main/CHANGELOG.md";
const HIGHLIGHT_MAX = 160;

/**
 * First paragraph of a version's CHANGELOG section — the release headline
 * ("Minor. **The method, enforced.** …"), bold stripped, truncated. Pure.
 */
export function parseChangelogHighlight(markdown, version) {
  const escapedVersion = version.replaceAll(".", String.raw`\.`);
  const section = String(markdown).split(new RegExp(String.raw`^## \[${escapedVersion}\][^\n]*$`, "m"))[1];
  if (!section) return null;
  const firstLine = section.split(/^##|^###/m)[0].split("\n").map((l) => l.trim()).find(Boolean);
  if (!firstLine) return null;
  const clean = firstLine.replaceAll("**", "");
  return clean.length > HIGHLIGHT_MAX ? `${clean.slice(0, HIGHLIGHT_MAX - 1)}…` : clean;
}

async function fetchHighlight(version) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(CHANGELOG_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return parseChangelogHighlight(await res.text(), version);
  } catch {
    return null;
  }
}

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
  if (process.env.KJ_NO_UPDATE_CHECK === "1") return null;
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
          return { updateAvailable: true, latest: cache.latest, current: currentVersion, highlight: cache.highlight || null };
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

    // KJC-TSK-0690: a NEWER version also fetches its headline once — the
    // notice tells the user what it brings, not just that it exists.
    const newer = latest !== currentVersion && compareVersions(latest, currentVersion) > 0;
    const highlight = newer ? await fetchHighlight(latest) : null;

    // Save cache
    await fs.mkdir(getKarajanHome(), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify({ latest, checkedAt: Date.now(), highlight }), "utf8");

    if (newer) return { updateAvailable: true, latest, current: currentVersion, highlight };
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
    if (result.highlight) console.log(`  What it brings: ${result.highlight}`);
    console.log(`  ${updateInstruction({ channel })}`);
    console.log("  Agent: tell your user and ask before updating — never update on your own.\n");
  }
}

/**
 * Run the self-update (`kj update`), channel-aware (KJC-BUG-0106).
 *
 * npm channel: `npm install -g` with CAPTURED output — success shows only
 * progress + result; npm's deprecation / allow-scripts / funding noise never
 * reaches the user. On failure the captured output IS surfaced.
 *
 * sea channel (standalone binary): npm-installing would update a copy the
 * PATH never resolves — the running binary stays old while `kj update`
 * reports success. Instead the binary installer is re-run (downloaded to a
 * temp file first, never piped from the network straight into a shell).
 *
 * Both channels end with a PATH probe: `kj --version` must report the new
 * version, otherwise a stale copy shadows the update and the command fails
 * LOUDLY naming the likely cause — never a silent "updated" that isn't.
 *
 * @param {Object} opts
 * @param {string} opts.currentVersion - version of the running kj
 * @param {(cmd: string, args: string[]) => Promise<{stdout: string, stderr: string}>} [opts.exec] - injectable runner (defaults to execa)
 * @param {Console} [opts.logger]
 * @param {"npm"|"sea"} [opts.channel] - injectable channel (defaults to detectInstallChannel())
 * @param {typeof fetch} [opts.fetchFn] - injectable fetch (registry lookup + installer download)
 * @returns {Promise<{ ok: boolean, alreadyLatest?: boolean, latest?: string, manual?: boolean }>}
 */
export async function performSelfUpdate({ currentVersion, exec, logger = console, channel, fetchFn = fetch } = {}) {
  const run = exec || (async (cmd, args) => (await import("execa")).execa(cmd, args));
  const ch = channel || detectInstallChannel();
  logger.log(`Current version: ${currentVersion}`);
  logger.log("Checking for updates...");

  let latest;
  try {
    // Registry over HTTP, not `npm view` — standalone-binary machines may
    // not have npm at all.
    const res = await fetchFn(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`registry responded ${res.status}`);
    latest = (await res.json()).version;
  } catch (err) {
    logger.error(`Update failed: could not check the registry (${err.message})`);
    return { ok: false };
  }

  if (latest === currentVersion) {
    logger.log(`Already on the latest version (${currentVersion}).`);
    return { ok: true, alreadyLatest: true, latest };
  }

  if (ch === "sea" && process.platform === "win32") {
    // Executing a downloaded .ps1 from inside the binary is not supported
    // yet — hand the user the exact command instead of half-updating.
    logger.log(`Update available: ${currentVersion} → ${latest} (standalone binary).`);
    logger.log(`${updateInstruction({ channel: "sea" })}`);
    return { ok: true, latest, manual: true };
  }

  logger.log(`Updating ${currentVersion} → ${latest}... (this can take a few minutes)`);
  try {
    if (ch === "sea") {
      // Re-run the binary installer: download to a temp file, then execute —
      // never pipe the network straight into a shell.
      const res = await fetchFn(INSTALL_SH_URL);
      if (!res.ok) throw new Error(`installer download failed (${res.status})`);
      const tmpScript = path.join(os.tmpdir(), `kj-install-${process.pid}.sh`);
      await fs.writeFile(tmpScript, await res.text(), { mode: 0o700 });
      try {
        await run("sh", [tmpScript]);
      } finally {
        await fs.rm(tmpScript, { force: true });
      }
    } else {
      // No stdio:inherit — capture and drop npm's warnings on the success path.
      await run("npm", ["install", "-g", `${PACKAGE_NAME}@latest`]);
    }
  } catch (err) {
    if (err.stdout) logger.error(err.stdout);
    if (err.stderr) logger.error(err.stderr);
    logger.error(`Update failed: ${err.shortMessage || err.message}`);
    return { ok: false };
  }

  // The install succeeded — but is the kj the USER runs actually the new one?
  const onPath = await verifyKjOnPath({ run, latest, logger });
  if (!onPath) return { ok: false };
  logger.log(`Updated to ${latest}. Restart Claude to pick up the new MCP server.`);
  return { ok: true, latest };
}

/**
 * Probe `kj --version` through the PATH and confirm it reports `latest`.
 * A mismatch means a stale copy shadows the freshly installed one (e.g. a
 * standalone binary in ~/.local/bin in front of the npm global prefix).
 */
async function verifyKjOnPath({ run, latest, logger }) {
  let reported;
  try {
    const { stdout } = await run("kj", ["--version"]);
    reported = String(stdout).trim();
  } catch (err) {
    logger.error(`Update installed ${latest}, but running \`kj --version\` failed: ${err.shortMessage || err.message}`);
    return false;
  }
  if (reported.includes(latest)) return true;
  logger.error(`Update installed ${latest}, but the \`kj\` on your PATH still reports ${reported}.`);
  logger.error("A stale copy is shadowing the update. Check `which -a kj` and remove the old one, or update through the channel that owns the first entry.");
  return false;
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
