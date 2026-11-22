/**
 * HU-4762: reads the sticky comment that a repo's codex review workflow writes as
 * github-actions[bot]. The format belongs to another repo, so it is read strictly and fails closed:
 * the comment opens with the lifecycle marker, holds one recommendation line and closes with the
 * codex-state block. Its findings quote text other people wrote, so a second marker, recommendation
 * or state anywhere in it is an error, never a choice between them.
 */

const LIFECYCLE = "<!-- codex-review-lifecycle:v1 -->";
const STATE_MARK = "<!-- codex-state:";
const STATE_LINE = /^<!-- codex-state:(\S*) -->$/;
const RECOMMENDATION_MARK = "**Recommendation:";
const RECOMMENDATION_LINE = /^\*\*Recommendation: (APPROVE|REQUEST_CHANGES)\*\*$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** The paths in the state that the return contract promises as strings. */
const STRING_FIELDS = ["status", "reviewed.head", "reviewed.base", "observedHead"];

const at = (value, path) => path.split(".").reduce((node, key) => node?.[key], value);
const failure = (why, options) => new Error(`codex-state comment: ${why}`, options);

/** Every form the parser accepts contains its mark, so a quoted copy of one is always counted. */
function requireOne(text, mark, what) {
  const count = text.split(mark).length - 1;
  if (count !== 1) throw failure(`${count} ${what} where the format has exactly one`);
}

function decode(encoded) {
  if (!BASE64.test(encoded)) throw failure("the state is not base64");
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch (err) {
    throw failure(`the state is not JSON (${err.message})`, { cause: err });
  }
}

function readRecommendation(text, lines) {
  requireOne(text, RECOMMENDATION_MARK, "recommendation lines");
  const recommendation = RECOMMENDATION_LINE.exec(lines.find((line) => line.includes(RECOMMENDATION_MARK)))?.[1];
  if (!recommendation) throw failure("the recommendation is neither APPROVE nor REQUEST_CHANGES");
  return recommendation;
}

function readState(text, lines) {
  requireOne(text, STATE_MARK, "codex-state blocks");
  const match = STATE_LINE.exec(lines.at(-1));
  if (!match) throw failure("its last line is not a codex-state block");
  const state = decode(match[1]);
  const findings = state?.findings;
  if (!Array.isArray(findings) || !findings.every((f) => f && typeof f === "object")) throw failure("the state has no findings array of objects");
  const missing = STRING_FIELDS.find((path) => typeof at(state, path) !== "string");
  if (missing) throw failure(`the state has no ${missing} string`);
  return state;
}

/** Whether a comment body claims to be a codex-state comment: it carries the lifecycle marker. */
export const isCodexStateComment = (body) => typeof body === "string" && body.includes(LIFECYCLE);

/**
 * The recommendation and the decoded state of a codex-state comment, or null when the body is not one.
 * @param {string} body
 * @returns {{recommendation: "APPROVE"|"REQUEST_CHANGES",
 *   state: {status: string, findings: object[], reviewed: {head: string, base: string}, observedHead: string}}|null}
 * @throws when the body has the lifecycle marker but not exactly that structure
 */
export function parseCodexState(body) {
  if (!isCodexStateComment(body)) return null;
  const text = body.trim();
  const lines = text.split(/\r?\n/);
  requireOne(text, LIFECYCLE, "lifecycle markers");
  if (lines[0] !== LIFECYCLE) throw failure("the lifecycle marker is not its first line");
  const recommendation = readRecommendation(text, lines);
  return { recommendation, state: readState(text, lines) };
}
