/**
 * Iteration phase: quality gates (TDD check, SonarQube local + cloud,
 * Impeccable design audit).
 *
 * Extracted verbatim from `src/orchestrator/drivers/iteration-loop.js` in
 * the v2.7.x audit follow-up to keep the iteration-loop driver under the
 * 600-LOC ceiling. Behaviour is byte-for-byte identical to the inlined
 * version.
 *
 * Returns { action: "ok" | "return" | "continue", result? }.
 *   - "ok"       → caller continues to the next phase.
 *   - "return"   → caller returns `result` (pause / stalled / blocked).
 *   - "continue" → caller continues the iteration loop (next iteration).
 */

import { generateDiff } from "../../../review/diff-generator.js";
import { withLock } from "../../../utils/async-lock.js";
import {
  runTddCheckStage, runSonarStage, runSonarCloudStage,
} from "../../iteration-stages.js";
import { runImpeccableStage } from "../../post-loop-stages.js";
import { runPerfStage } from "../../stages/perf-stage.js";
import { runTddDisciplineStage } from "../../stages/tdd-discipline-stage.js";
import { runToolJudgeStage } from "../../stages/tool-judge-stage.js";
import { tryCiComment } from "../../ci-integration.js";

export async function runQualityGateStages({ config, logger, emitter, eventBase, session, trackBudget, i, askQuestion, repeatDetector, budgetSummary, sonarState, task, stageResults, coderRole, pipelineFlags, brainCtx }) {
  const tddResult = await runTddCheckStage({ config, logger, emitter, eventBase, session, trackBudget, iteration: i, askQuestion, task, brainCtx });
  if (tddResult.action === "pause") return { action: "return", result: tddResult.result };
  if (tddResult.action === "continue") return { action: "continue" };

  // KJC-TSK-0398 PR3: opt-in red-then-green check.
  if (config.development?.require_red_then_green) {
    const disc = await runTddDisciplineStage({
      config, logger, emitter, eventBase,
      sourceFiles: tddResult.sourceFiles || [],
      testFiles: tddResult.testFiles || [],
    });
    if (disc.action === "continue") return { action: "continue" };
  }

  // Sonar runs for code tasks per policy. Since v2.7.4 it is NOT
  // toggleable via config — that's intrinsic to Karajan. The taskType
  // policy (resolved_policies.sonar) is the single source of truth.
  // Solomon may skip a single iteration via rule alerts; that's a
  // runtime decision, not a config option.
  //
  // Test-harness escape hatch via config.testHarness.disableSonarStage
  // — production code reads `config?.testHarness?.disableSonarStage`,
  // never `globalThis.*`. The legacy override surface is documented
  // (and exclusively read) in src/config/test-harness.js. ESLint rule
  // (#557) blocks any re-introduction of `globalThis.__KJ_*` outside
  // that one file.
  const sonarStageDisabledForTest = config?.testHarness?.disableSonarStage === true;
  if (!sonarStageDisabledForTest && session.resolved_policies?.sonar !== false) {
    // Serialize across parallel HU lanes (KJC-TSK-0625): the SonarQube
    // server scans one project key at a time. No-op on sequential runs.
    const sonarResult = await withLock("sonar-scan", () => runSonarStage({
      config, logger, emitter, eventBase, session, trackBudget, iteration: i,
      repeatDetector, budgetSummary, sonarState, askQuestion, task, brainCtx
    }));
    if (sonarResult.action === "stalled" || sonarResult.action === "pause") return { action: "return", result: sonarResult.result };
    if (sonarResult.action === "continue") return { action: "continue" };
    if (sonarResult.stageResult) {
      stageResults.sonar = sonarResult.stageResult;
      await tryCiComment({ config, session, logger, agent: "Sonar", body: `SonarQube scan: ${sonarResult.stageResult.summary || "completed"}` });
    }
  }

  if (config.sonarcloud?.enabled) {
    const cloudResult = await runSonarCloudStage({
      config, logger, emitter, eventBase, session, trackBudget, iteration: i
    });
    if (cloudResult.stageResult) {
      stageResults.sonarcloud = cloudResult.stageResult;
    }
  }

  if (pipelineFlags?.impeccableEnabled) {
    const diff = await generateDiff({ baseRef: session.session_start_sha, projectDir: config?.projectDir || null });
    const impeccableMode = pipelineFlags?.impeccableMode || "audit";
    const impeccableResult = await runImpeccableStage({
      config, logger, emitter, eventBase, session, coderRole, trackBudget,
      iteration: i, task, diff, mode: impeccableMode
    });
    if (impeccableResult.stageResult) {
      stageResults.impeccable = impeccableResult.stageResult;
    }
  }

  if (pipelineFlags?.perfEnabled) {
    const perfResult = await runPerfStage({
      config, logger, emitter, eventBase, session, trackBudget,
      iteration: i, task, brainCtx
    });
    if (perfResult.stageResult) {
      stageResults.perf = perfResult.stageResult;
    }
    if (perfResult.action === "continue") return { action: "continue" };
  }

  // KJC-TSK-0375 PR3: opt-in tool-call quality judge. Non-blocking.
  if (pipelineFlags?.toolJudgeEnabled) {
    const judgeResult = await runToolJudgeStage({
      config, logger, emitter, eventBase, session, coderRole, trackBudget,
      iteration: i, task,
    });
    if (judgeResult.stageResult) {
      stageResults.toolJudge = judgeResult.stageResult;
    }
  }

  return { action: "ok" };
}
