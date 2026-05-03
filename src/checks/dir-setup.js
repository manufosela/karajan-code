/**
 * Ensure ~/.karajan/ directory tree exists. Strategy: auto — creating
 * directories under the user's home is non-invasive.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { STRATEGY } from "./types.js";

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
      const home = os.homedir();
      const root = path.join(home, ".karajan");
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

export function getDirSetupChecks() {
  return [createKarajanDirsCheck()];
}
