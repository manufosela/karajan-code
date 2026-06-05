/**
 * Squeezr availability check. Manual strategy — installation
 * depends on the host platform and is handled by getInstallCommand().
 */

import { runCommand } from "../utils/process.js";
import { getInstallCommand } from "../utils/os-detect.js";
import { withDocLink } from "../utils/doc-links.js";
import { STRATEGY } from "./types.js";

function createSqueezrCheck() {
  return {
    name: "squeezr",
    label: "Squeezr",
    strategy: STRATEGY.MANUAL,
    async detect() {
      try {
        const res = await runCommand("squeezr", ["--version"]);
        if (res.exitCode === 0) {
          return { ok: true, severity: "info", detail: `${res.stdout.trim()} — context compression active` };
        }
      } catch { /* not installed */ }
      const installCmd = getInstallCommand("squeezr");
      return {
        ok: false,
        severity: "warn",
        detail: "Not found — context compression via Squeezr available",
        fix: withDocLink(`Install: ${installCmd}`, "squeezr_install"),
      };
    },
  };
}

export function getSqueezrChecks() {
  return [createSqueezrCheck()];
}
