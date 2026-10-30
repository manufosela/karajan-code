/**
 * MCP server handler logic.
 * Shared helpers live in ./shared-helpers.js (to avoid circular imports).
 * Handler implementations are in ./handlers/*.
 * This module re-exports everything so existing imports continue to work.
 */

// ── Shared helpers (re-exported from shared-helpers.js) ──────────────
export {
  resolveProjectDir,
  asObject,
  responseText,
  failPayload,
  assertNotOnBaseBranch,
  enrichedFailPayload,
  buildConfig,
  buildAskQuestion,
  buildDirectEmitter,
  classifyError
} from "./shared-helpers.js";

// ── Sub-module re-exports ────────────────────────────────────────────
export { handleRunDirect, handleResumeDirect, validateResumeAnswer, handleRun, handleResume } from "./handlers/run-handler.js";
export { handlePlanDirect, handleCodeDirect, handleReviewDirect, handleDiscoverDirect, handleTriageDirect, handleResearcherDirect, handleAuditDirect, handleArchitectDirect, handleCode, handleReview, handlePlan, handleDiscover, handleTriage, handleResearcher, handleArchitect, handleAudit } from "./handlers/direct-handlers.js";
export { handleStatus, handleAgents, handlePreflight, handleRoles, handleReport, handleInit, handleDoctor, handleConfig, handleScan, handleBoard, handleUndo, handleClean, buildPreflightRequiredResponse } from "./handlers/management-handlers.js";
export { handleHu, handleSuggest } from "./handlers/hu-handlers.js";

// ── Handler dispatch ─────────────────────────────────────────────────

import { asObject, failPayload } from "./shared-helpers.js";
import { handleCode, handleDiscover, handleAudit } from "./handlers/direct-handlers.js";
import {
  handleAgents, handlePreflight, handleRoles,
  handleReport, handleInit, handleDoctor, handleConfig,
  handleScan, handleBoard, handleClean
} from "./handlers/management-handlers.js";
import { retiredMessage } from "../cli/retired-commands.js";

// KJC-TSK-1318: the tools of the kj run pipeline, retired in 5.0 with their
// commands; a call answers with the same notice and starts nothing.
const RETIRED_TOOLS = {
  kj_run: "run", kj_resume: "resume", kj_plan: "plan generate", kj_status: "status", kj_undo: "undo",
  kj_triage: "triage", kj_researcher: "researcher", kj_architect: "architect", kj_review: "review",
};
import { handleHu, handleSuggest } from "./handlers/hu-handlers.js";
import { handleRagQuery, handleRagIndex } from "./handlers/rag-handler.js";
import { withKarajanHome } from "../utils/paths.js";

export async function handleToolCall(name, args, server, extra) {
  if (Object.hasOwn(RETIRED_TOOLS, name)) return failPayload(retiredMessage(RETIRED_TOOLS[name]));
  const a = asObject(args);
  const handler = {
    kj_init:        (a) => handleInit(a),
    kj_doctor:      (a) => handleDoctor(a),
    kj_agents:      (a) => handleAgents(a),
    kj_preflight:   (a) => handlePreflight(a),
    kj_config:      (a) => handleConfig(a),
    kj_scan:        (a, server) => handleScan(a, server),
    kj_roles:       (a) => handleRoles(a),
    kj_report:      (a) => handleReport(a),
    kj_code:        (a, server, extra) => handleCode(a, server, extra),
    kj_discover:    (a, server, extra) => handleDiscover(a, server, extra),
    kj_audit:       (a, server, extra) => handleAudit(a, server, extra),
    kj_board:       (a) => handleBoard(a),
    kj_hu:          (a, server) => handleHu(a, server),
    kj_suggest:     (a) => handleSuggest(a),
    kj_clean:       (a) => handleClean(a),
    kj_rag_query:   (a, server) => handleRagQuery(a, server),
    kj_rag_index:   (a, server) => handleRagIndex(a, server),
  }[name];
  if (handler) {
    // KJC-BUG-0176 (#1722): `kjHome` only reached the env of the `kj`
    // subprocesses spawned by run-kj.js; the direct handlers resolve the
    // home from THIS process (bootstrap gate, config load), so the
    // argument was ignored and the gate failed with "Config file not
    // found". Pin the home to this call's async context instead — no
    // env mutation, so overlapping calls never see each other's home.
    const kjHome = typeof a.kjHome === "string" && a.kjHome.trim() !== "" ? a.kjHome : null;
    return kjHome
      ? withKarajanHome(kjHome, () => handler(a, server, extra))
      : handler(a, server, extra);
  }
  return failPayload(`Unknown tool: ${name}`);
}
