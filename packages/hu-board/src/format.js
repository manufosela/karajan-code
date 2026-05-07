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
