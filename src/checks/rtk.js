/**
 * RTK (Rust Token Killer) availability check. Manual strategy — installation
 * depends on the host platform and is handled by getInstallCommand().
 */

import { runCommand } from "../utils/process.js";
import { getInstallCommand } from "../utils/os-detect.js";
import { withDocLink } from "../utils/doc-links.js";
import { STRATEGY } from "./types.js";

function createRtkCheck() {
  return {
    name: "rtk",
    label: "RTK (Rust Token Killer)",
    strategy: STRATEGY.MANUAL,
    async detect() {
      try {
        const res = await runCommand("rtk", ["--version"]);
        if (res.exitCode === 0) {
          return { ok: true, severity: "info", detail: `${res.stdout.trim()} — token savings active` };
        }
      } catch { /* not installed */ }
      const installCmd = getInstallCommand("rtk");
      return {
        ok: false,
        severity: "warn",
        detail: "Not found — 60-90% token savings available",
        fix: withDocLink(`Install: ${installCmd}`, "rtk_install"),
      };
    },
  };
}

export function getRtkChecks() {
  return [createRtkCheck()];
}
