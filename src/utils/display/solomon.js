import { ANSI } from "./formatters.js";

export const SOLOMON_RULING_HANDLERS = {
  approve(detail, elapsed) {
    const dismissedCount = detail?.dismissed?.length || 0;
    const dismissedSuffix = dismissedCount > 0 ? ` (${dismissedCount} dismissed)` : "";
    console.log(`  \u251c\u2500 ${ANSI.green}\u2696\ufe0f Solomon: APPROVE${dismissedSuffix}${ANSI.reset}  ${elapsed}`);
  },
  approve_with_conditions(detail, elapsed) {
    const condCount = detail?.conditions?.length || 0;
    console.log(`  \u251c\u2500 ${ANSI.yellow}\u2696\ufe0f Solomon: ${condCount} condition${condCount === 1 ? "" : "s"}${ANSI.reset}  ${elapsed}`);
    if (detail?.conditions) {
      for (const cond of detail.conditions) {
        console.log(`  \u2502   ${ANSI.dim}${cond}${ANSI.reset}`);
      }
    }
  },
  escalate_human(detail, elapsed) {
    const reason = detail?.escalate_reason || "unknown reason";
    console.log(`  \u251c\u2500 ${ANSI.red}\u2696\ufe0f Solomon: ESCALATE \u2014 ${reason}${ANSI.reset}  ${elapsed}`);
  },
  create_subtask(detail, elapsed) {
    const subtaskTitle = detail?.subtask?.title || "untitled";
    console.log(`  \u251c\u2500 ${ANSI.magenta}\u2696\ufe0f Solomon: SUBTASK \u2014 ${subtaskTitle}${ANSI.reset}  ${elapsed}`);
  }
};

/**
 * Print Solomon ruling details
 * @param {Object} detail 
 * @param {string} elapsed 
 */
export function printSolomonRuling(detail, elapsed) {
  const ruling = detail?.ruling || "unknown";
  const handler = SOLOMON_RULING_HANDLERS[ruling];
  if (handler) {
    handler(detail, elapsed);
  } else {
    const rulingUpper = ruling.toUpperCase().replaceAll("_", " ");
    console.log(`  \u251c\u2500 \u2696\ufe0f Solomon: ${rulingUpper}  ${elapsed}`);
  }
}
