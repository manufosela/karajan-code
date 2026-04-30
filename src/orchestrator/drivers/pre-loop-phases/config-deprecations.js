/**
 * Extracted from `src/orchestrator/drivers/pre-loop.js` in TSK-0337
 * (audit recommendation #6: continue pre-loop extraction). pre-loop.js
 * had grown to 626 LOC, over the 600-LOC ceiling that the file's own
 * docstring set. Splitting the deprecation warnings, addyosmani skill
 * bootstrap, and auto-HU batch generation into their own modules brings
 * the driver back to ~440 LOC.
 *
 * Behaviour unchanged. The function is exported with the same name and
 * signature so the move is mechanical.
 *
 * Emits one-shot warnings for config keys ignored since v2.7.4. Currently:
 *   - `sonarqube.enabled` (kj.config.yml) → ignored, sonar is intrinsic
 *   - `--no-sonar` CLI flag → ignored
 */

import { emitProgress, makeEvent } from "../../../utils/events.js";

export function emitConfigDeprecations(config, logger, emitter, eventBase) {
  const dep = config?._deprecated;
  if (!dep) return;

  if (dep.sonarqubeEnabledKey) {
    const m =
      "DEPRECATED: `sonarqube.enabled` in kj.config.yml is ignored since v2.7.4. " +
      "Sonar is intrinsic to Karajan for code tasks (sw/refactor/add-tests) and " +
      "skipped for non-code tasks (audit/doc/infra/analysis/no-code) by policy. " +
      "Remove the key from your config to silence this warning.";
    logger.warn(m);
    emitProgress(emitter, makeEvent("config:deprecated", { ...eventBase, stage: "config" }, {
      message: m,
      detail: { key: "sonarqube.enabled", since: "v2.7.4" },
    }));
  }

  if (dep.noSonarFlag) {
    const m =
      "DEPRECATED: `--no-sonar` flag is ignored since v2.7.4. Sonar runs for code " +
      "tasks by policy. To skip Sonar on a one-off run, use a non-code task type " +
      "(e.g. `--task-type doc`) or rely on Solomon's runtime override.";
    logger.warn(m);
    emitProgress(emitter, makeEvent("config:deprecated", { ...eventBase, stage: "config" }, {
      message: m,
      detail: { flag: "--no-sonar", since: "v2.7.4" },
    }));
  }
}
