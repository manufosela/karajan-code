// KJC-TSK-0375 PR3 — ToolJudgeStage.
// Opt-in (`pipeline.tool_judge.enabled`). Scores the coder's tool calls
// extracted from `session.last_coder_transcript`. Non-blocking: a low
// score emits a warn event and surfaces in summary but never gates the
// iteration loop. Wiring lives in `quality-gates.js`.

import { ToolCorrectnessJudgeRole } from "../../roles/tool-correctness-judge-role.js";
import { extractToolCalls } from "../../utils/tool-call-extractor.js";
import { emitProgress, makeEvent } from "../../utils/events.js";

export async function runToolJudgeStage({
  config, logger, emitter, eventBase, session, coderRole, trackBudget,
  iteration, task,
  extractFn = extractToolCalls,
  RoleClass = ToolCorrectnessJudgeRole,
} = {}) {
  logger?.setContext?.({ iteration, stage: "tool-judge" });
  emitProgress(emitter, makeEvent("toolJudge:start", { ...eventBase, stage: "tool-judge" }, {
    message: "Tool-judge scoring coder tool calls",
  }));

  const transcript = session?.last_coder_transcript || "";
  const provider = coderRole?.provider || "claude";
  const toolCalls = extractFn({ transcript, provider });

  const role = new RoleClass({ config, logger, emitter });
  const roleResult = await role.execute({ task, toolCalls });

  try { trackBudget?.("tool-judge", roleResult.usage || { tokens_in: 0, tokens_out: 0, cost_usd: 0 }); } catch { /* best-effort */ }

  const r = roleResult.result;
  const status = r?.skipped ? "skip" : r?.lowQuality ? "warn" : roleResult.ok ? "ok" : "fail";

  emitProgress(emitter, makeEvent("toolJudge:end", { ...eventBase, stage: "tool-judge" }, {
    status,
    message: roleResult.summary || "tool-judge done",
    detail: { score: r?.score ?? null, threshold: r?.threshold ?? null, skipped: Boolean(r?.skipped), callCount: toolCalls.length },
  }));

  return {
    action: "ok",
    stageResult: {
      ok: roleResult.ok !== false,
      score: r?.score ?? null,
      lowQuality: Boolean(r?.lowQuality),
      skipped: Boolean(r?.skipped),
      threshold: r?.threshold ?? null,
      summary: roleResult.summary || "",
      breakdown: r?.breakdown || [],
      callCount: toolCalls.length,
    },
  };
}
