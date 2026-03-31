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
export { handleStatus, handleAgents, handlePreflight, handleRoles, handleReport, handleInit, handleDoctor, handleConfig, handleScan, handleBoard, handleUndo, buildPreflightRequiredResponse } from "./handlers/management-handlers.js";
export { handleHu, handleSkills, handleSuggest } from "./handlers/hu-handlers.js";

// ── Handler dispatch ─────────────────────────────────────────────────

import { asObject, failPayload } from "./shared-helpers.js";
import { handleRun, handleResume } from "./handlers/run-handler.js";
import {
  handleCode, handleReview, handlePlan, handleDiscover,
  handleTriage, handleResearcher, handleArchitect, handleAudit
} from "./handlers/direct-handlers.js";
import {
  handleStatus, handleAgents, handlePreflight, handleRoles,
  handleReport, handleInit, handleDoctor, handleConfig,
  handleScan, handleBoard, handleUndo
} from "./handlers/management-handlers.js";
import { handleHu, handleSkills, handleSuggest } from "./handlers/hu-handlers.js";

export async function handleToolCall(name, args, server, extra) {
  const a = asObject(args);
  const handler = {
    kj_status:      (a, server) => handleStatus(a, server),
    kj_init:        (a) => handleInit(a),
    kj_doctor:      (a) => handleDoctor(a),
    kj_agents:      (a) => handleAgents(a),
    kj_preflight:   (a) => handlePreflight(a),
    kj_config:      (a) => handleConfig(a),
    kj_scan:        (a, server) => handleScan(a, server),
    kj_roles:       (a) => handleRoles(a),
    kj_report:      (a) => handleReport(a),
    kj_resume:      (a, server, extra) => handleResume(a, server, extra),
    kj_run:         (a, server, extra) => handleRun(a, server, extra),
    kj_code:        (a, server, extra) => handleCode(a, server, extra),
    kj_review:      (a, server, extra) => handleReview(a, server, extra),
    kj_plan:        (a, server, extra) => handlePlan(a, server, extra),
    kj_discover:    (a, server, extra) => handleDiscover(a, server, extra),
    kj_triage:      (a, server, extra) => handleTriage(a, server, extra),
    kj_researcher:  (a, server, extra) => handleResearcher(a, server, extra),
    kj_architect:   (a, server, extra) => handleArchitect(a, server, extra),
    kj_audit:       (a, server, extra) => handleAudit(a, server, extra),
    kj_board:       (a) => handleBoard(a),
    kj_hu:          (a, server) => handleHu(a, server),
    kj_suggest:     (a) => handleSuggest(a),
    kj_skills:      (a) => handleSkills(a),
    kj_undo:        (a, server) => handleUndo(a, server)
  }[name];
  if (handler) {
    return handler(a, server, extra);
  }
  return failPayload(`Unknown tool: ${name}`);
}
