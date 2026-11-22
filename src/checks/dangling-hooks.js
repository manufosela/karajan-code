/**
 * HU-4779: a hook in .claude/settings.json or settings.local.json that runs a
 * `.karajan/harness/<file>` that does not exist makes node crash on every tool call, and kj doctor
 * said "All checks passed". wiringState already finds those hooks (HU-4768); this says them.
 */
import { wiringState } from "../harden/harness-hooks.js";
import { SENTINEL_WIRING } from "../harden/sentinel-hooks.js";
import { STRATEGY } from "./types.js";

const FIX = "remove those lines from that settings file, or run `kj harden` from the main checkout";

export function getDanglingHookChecks(config) {
  return [{
    name: "dangling-hooks",
    label: "Hooks that run a missing harness file",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const projectDir = config?.projectDir || process.cwd();
      const { dangling } = wiringState({ projectDir, entries: SENTINEL_WIRING });
      if (dangling.length === 0) return { ok: true, severity: "info", detail: "every hook runs a harness file that exists" };
      return { ok: false, severity: "fail", detail: dangling.join("; "), fix: FIX };
    },
  }];
}
