// KJC-TSK-0470 — `kj doctor` check for the AI Harness Scorecard image.
// Reports Disabled / Docker missing / Image not pulled / OK. The image
// is pulled lazily by `kj audit` on first use; this check is informational.
import { isDockerAvailable, isHarnessImagePresent, normalizeHarnessConfig } from "../audit/harness-scorecard.js";
import { STRATEGY } from "./types.js";

function harnessEnabled(config) { return config?.audit?.harness?.enabled !== false; }

function createHarnessScorecardCheck() {
  return {
    name: "harness-scorecard",
    label: "AI Harness Scorecard (audit)",
    strategy: STRATEGY.NONE,
    async detect({ config }) {
      const cfg = normalizeHarnessConfig(config?.audit?.harness || {});
      if (!harnessEnabled(config)) {
        return { ok: true, severity: "info", detail: "Disabled in config (audit.harness.enabled=false)" };
      }
      let docker; try { docker = await isDockerAvailable(); } catch { docker = false; }
      if (!docker) return {
        ok: false, severity: "warn",
        detail: "Docker not available — kj audit will skip the harness step.",
        fix: "Install Docker (or run `kj audit --no-harness` to silence this).",
        extra: { docker: false, image: cfg.image },
      };
      let cached; try { cached = await isHarnessImagePresent(cfg.image); } catch { cached = false; }
      if (!cached) return {
        ok: true, severity: "info",
        detail: `Will be pulled on first \`kj audit\` run (${cfg.image}).`,
        extra: { docker: true, cached: false, image: cfg.image },
      };
      return {
        ok: true, severity: "info",
        detail: `Image cached locally (${cfg.image}).`,
        extra: { docker: true, cached: true, image: cfg.image },
      };
    },
  };
}

export function getHarnessScorecardChecks() { return [createHarnessScorecardCheck()]; }
