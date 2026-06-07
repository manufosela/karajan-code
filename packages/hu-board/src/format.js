/**
 * Pure formatters used by the board UI to turn database rows into
 * human-friendly labels. No DOM, no node APIs — easy to unit-test.
 */

const TIME_RE_FALLBACK = "—";
const MAX_TASK_CHARS = 60;
const MAX_PROJECT_CHARS = 40;

/**
 * Format an ISO 8601 timestamp as `HH:MM` (24h, local time of the
 * server). Falls back to `—` when the input is missing or unparseable
 * so the UI never renders `Invalid Date` or `null`.
 *
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function formatHHMM(iso) {
  if (!iso) return TIME_RE_FALLBACK;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return TIME_RE_FALLBACK;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Truncate a task description to a max of N chars, collapsing internal
 * whitespace, suffixed with "…" when truncated. Returns "" when the
 * input is empty so the caller can decide whether to render the slot.
 *
 * @param {string|null|undefined} text
 * @param {number} [max=MAX_TASK_CHARS]
 * @returns {string}
 */
export function shortTask(text, max = MAX_TASK_CHARS) {
  if (!text) return "";
  const collapsed = String(text).replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Build the label tuple used by `renderSessionCard` and
 * `showSessionDetail`. The board used to print the session.id verbatim
 * (e.g. `s_2026-05-07T08-35-58-010Z`) which is technically correct but
 * impossible to scan at a glance — the user explicitly flagged this
 * during pre-talk testing on 2026-05-07.
 *
 * Returned shape:
 *   - `title`: bold-line title for the card (project + time).
 *     Always non-empty; falls back to the session id when no project
 *     is known so the card is never blank.
 *   - `subtitle`: short task summary (≤ 60 chars). Empty when the
 *     session has no task field — caller hides the slot.
 *   - `idChip`: the cryptic session id, kept available for the user
 *     who needs it for `kj resume <id>` and as a tooltip on the title.
 *
 * @param {{ id: string, project_name?: string|null, task?: string|null,
 *           created_at?: string|null }} session
 * @returns {{ title: string, subtitle: string, idChip: string }}
 */
/**
 * Format a per-HU cost (USD) for the card badge. Cost F (KJC-TSK-0517).
 *
 * Two outputs in one call so the UI can render both at once:
 *   - `label`: 2-decimal "$X.XX" shown on the card (compact).
 *   - `tooltip`: 4-decimal "Estimated cost: $X.XXXX" shown on hover
 *     (matches the precision aggregated by Cost B/C/D, see
 *     `packages/core/src/cost/index.js`).
 *
 * Returns `null` for null/undefined/non-finite inputs so the caller
 * skips the badge entirely (rendering "$0.00" for an unknown cost
 * would be misleading — there is a real difference between "we know it
 * was free" and "we haven't measured it yet").
 *
 * @param {number|null|undefined} costUsd
 * @returns {{ label: string, tooltip: string } | null}
 */
export function formatCost(costUsd) {
  if (costUsd === null || costUsd === undefined) return null;
  const n = Number(costUsd);
  if (!Number.isFinite(n)) return null;
  return {
    label: `$${n.toFixed(2)}`,
    tooltip: `Estimated cost: $${n.toFixed(4)}`,
  };
}

/**
 * Format the aggregated project-level cost chip rendered in the board
 * header. Cost G (KJC-TSK-0518). Consumes the shape returned by
 * `GET /api/projects/:id/cost` (Cost E):
 *   { totalUsd, byPlan: [{planId, totalUsd, huCount}, …],
 *     unknownModelTokens: { tokensIn, tokensOut, models }, currency }
 *
 * Returns `{ label, tooltip }` where:
 *   - `label` is the compact "Total: $X.XX" shown in the header.
 *   - `tooltip` is a multi-line string with full precision, the
 *     per-plan breakdown, and a note when some tokens used a model we
 *     don't price (they aren't included in the total — surfacing the
 *     skip is more honest than silently swallowing it).
 *
 * Returns `null` when there is nothing to show (no input, or no
 * measured cost yet and no plans). The chip is then hidden — same
 * reasoning as `formatCost`: "$0.00" with no data is misleading.
 *
 * @param {{totalUsd:number, byPlan?:Array, unknownModelTokens?:object}|null|undefined} cost
 * @returns {{ label: string, tooltip: string } | null}
 */
export function formatProjectCostSummary(cost) {
  if (!cost || typeof cost !== "object") return null;
  const total = Number(cost.totalUsd);
  if (!Number.isFinite(total)) return null;
  const byPlan = Array.isArray(cost.byPlan) ? cost.byPlan : [];
  if (total === 0 && byPlan.length === 0) return null;

  const lines = [`Total: $${total.toFixed(4)}`];
  if (byPlan.length > 0) {
    lines.push("By plan:");
    for (const p of byPlan) {
      const planTotal = Number(p?.totalUsd);
      if (!Number.isFinite(planTotal)) continue;
      const huCount = Number.isFinite(p?.huCount) ? p.huCount : 0;
      const planLabel = p?.planId || "unassigned";
      lines.push(`  ${planLabel}: $${planTotal.toFixed(2)} (${huCount} HU${huCount === 1 ? "" : "s"})`);
    }
  }
  const unk = cost.unknownModelTokens;
  if (unk && Number.isFinite(unk.tokensIn) && Number.isFinite(unk.tokensOut)) {
    const unkTotal = unk.tokensIn + unk.tokensOut;
    if (unkTotal > 0) {
      lines.push(`(${unkTotal} tokens with unknown pricing not included)`);
    }
  }
  return {
    label: `Total: $${total.toFixed(2)}`,
    tooltip: lines.join("\n"),
  };
}

export function formatSessionLabel(session) {
  if (!session || !session.id) {
    return { title: "(no session)", subtitle: "", idChip: "" };
  }
  const projectName = (session.project_name || "").trim();
  const time = formatHHMM(session.created_at);
  const projectPart = projectName
    ? projectName.length > MAX_PROJECT_CHARS
      ? projectName.slice(0, MAX_PROJECT_CHARS - 1) + "…"
      : projectName
    : session.id;  // fall back so a card without a joined project never
                   // ends up blank — the cryptic id is better than empty
  const title = time !== TIME_RE_FALLBACK
    ? `${projectPart} · ${time}`
    : projectPart;
  return {
    title,
    subtitle: shortTask(session.task, MAX_TASK_CHARS),
    idChip: session.id,
  };
}
