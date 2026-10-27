/**
 * KJC-TSK-1253: npm registry signatures and provenance of the installed dependencies, for
 * `kj audit` and `kj audit --security`. `npm audit signatures` checks every installed package
 * against the registry's signing keys (and its Sigstore provenance when published with it):
 * an invalid signature means a tampered package, a missing one a package the registry cannot
 * vouch for. Same best-effort shape as osv-findings: when it does not apply or cannot run, the
 * section says why and the audit goes on.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runGoverned } from "../utils/tool-governor.js";

const TIMEOUT_MS = 60_000;
const pick = (list) => (Array.isArray(list) ? list.map((p) => ({ name: p?.name ?? "?", version: p?.version ?? "?" })) : []);

/** @returns {Promise<{available: boolean, reason?: string, invalid?: {name, version}[], missing?: {name, version}[]}>} */
export async function collectNpmSignatures(projectDir, logger = null) {
  if (!existsSync(join(projectDir, "package-lock.json")) || !existsSync(join(projectDir, "node_modules"))) {
    return { available: false, reason: "not an installed npm project (needs package-lock.json and node_modules)" };
  }
  // Same kill-switch as the other scanners: never from the unit suite without the opt-in.
  if (process.env.VITEST && process.env.KJ_ALLOW_REAL_SCANS !== "1") {
    return { available: false, reason: "real scans disabled under the test runner (set KJ_ALLOW_REAL_SCANS=1 to opt in)" };
  }
  let stdout;
  try {
    ({ stdout } = await runGoverned("npm", ["audit", "signatures", "--json"], { cwd: projectDir, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }));
  } catch (err) {
    // npm exits non-zero when a signature is invalid or missing: its JSON is still the answer.
    if (err.code === "ENOENT") return { available: false, reason: "npm not found in PATH" };
    if (err.killed) return { available: false, reason: `npm audit signatures timed out after ${TIMEOUT_MS}ms` };
    stdout = err.stdout;
  }
  try {
    const parsed = JSON.parse(stdout);
    return { available: true, invalid: pick(parsed.invalid), missing: pick(parsed.missing) };
  } catch {
    logger?.warn?.("npm audit signatures: output not parseable as JSON");
    return { available: false, reason: "npm audit signatures output not parseable as JSON" };
  }
}
