/**
 * Ensure ~/.karajan/ directory tree exists. Strategy: auto — creating
 * directories under the user's home is non-invasive.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { STRATEGY } from "./types.js";
import { getKarajanHome } from "../utils/paths.js";

const REQUIRED_DIRS = [
  "", // ~/.karajan/
  "sessions",
  "skills-cache",
  "logs",
];

/**
 * @internal Exported for dynamic import from tests/checks/dir-setup.test.js
 * and tests/checks/auto-remediation-e2e.test.js. Knip false positive.
 */
export function createKarajanDirsCheck() {
  return {
    name: "karajan-dirs",
    label: "~/.karajan directory tree",
    strategy: STRATEGY.AUTO,
    describe: "Create missing ~/.karajan subdirectories",
    async detect() {
      // KJC-TSK-0420: KARAJAN_HOME / KJ_HOME aware via getKarajanHome().
      const root = getKarajanHome();
      const home = os.homedir(); // still needed for path.relative() below
      const missing = [];
      for (const sub of REQUIRED_DIRS) {
        const full = sub ? path.join(root, sub) : root;
        try {
          const stat = await fs.stat(full);
          if (!stat.isDirectory()) missing.push(full);
        } catch {
          missing.push(full);
        }
      }
      if (missing.length === 0) {
        return { ok: true, severity: "info", detail: `All ${REQUIRED_DIRS.length} directories present under ${root}` };
      }
      return {
        ok: false,
        severity: "fail",
        detail: `Missing: ${missing.map((m) => path.relative(home, m)).join(", ")}`,
        fix: `mkdir -p ${missing.join(" ")}`,
        extra: { missing },
      };
    },
    async remediate({ extra }) {
      const missing = extra?.missing || [];
      for (const dir of missing) {
        await fs.mkdir(dir, { recursive: true });
      }
      return {
        fixed: true,
        detail: `Created ${missing.length} director${missing.length === 1 ? "y" : "ies"} under ~/.karajan`,
      };
    },
  };
}

/**
 * Detect a populated legacy `~/.kj/` left over from before
 * KJC-PCS-0047 PR 3. The auto-migrator (src/utils/home-migration.js)
 * moves its contents to `~/.karajan/` on the next `kj` invocation,
 * so the fix is simply "run any kj command". Severity is `warn`
 * (informational) because the legacy dir does not break anything —
 * it just won't get read by the board until the migration runs.
 * @internal Exported for dynamic import from tests.
 */
export function createLegacyKjHomeCheck() {
  return {
    name: "legacy-kj-home",
    label: "legacy ~/.kj/ directory",
    strategy: STRATEGY.MANUAL,
    describe: "Detect unmigrated ~/.kj/ left over from pre-2.19 layout",
    async detect() {
      const legacy = path.join(os.homedir(), ".kj");
      try {
        const entries = await fs.readdir(legacy);
        if (entries.length === 0) return { ok: true, severity: "info", detail: "Empty legacy ~/.kj/" };
        const marker = path.join(getKarajanHome(), ".kj-migrated.json"); // KJC-TSK-0420
        try { await fs.access(marker); return { ok: true, severity: "info", detail: "Already migrated" }; }
        catch { /* no marker, still pending */ }
        return {
          ok: false,
          severity: "warn",
          detail: `~/.kj/ still has ${entries.length} entries; will be migrated on the next kj invocation`,
          fix: "Run any kj command (e.g. `kj doctor`) — the migrator runs automatically",
        };
      } catch { return { ok: true, severity: "info", detail: "No legacy ~/.kj/" }; }
    },
  };
}

export function getDirSetupChecks() {
  return [createKarajanDirsCheck(), createLegacyKjHomeCheck()];
}
