/**
 * Answers to a release proposal (ADR 0057, step 3): one issue comment per answer, with a JSON block
 * at its end, and the pure rule that says who confirmed, who holds, who is silent and whether it is ready.
 */
import { sanitize } from "../environment/issue-report.js";
import { commentBlock } from "./proposal.js";

const MARKER = "kj-release:ack";
const OPEN = `<!-- ${MARKER} `;
const CLOSE = "-->";
const DECISIONS = ["ok", "hold", "include"];

/** @returns {string} a short readable line plus the block */
export function renderAnswer(answer) {
  const why = answer.why ? `: ${answer.why}` : "";
  const { detail, ...check } = answer.check ?? {};
  const fence = "```";
  const shown = detail ? `\n\n<details><summary>Why the check failed</summary>\n\n${fence}\n${sanitize(detail).replaceAll(fence, "'''")}\n${fence}\n\n</details>` : "";
  const block = commentBlock(MARKER, answer.check ? { ...answer, check } : answer);
  return `${answer.decision} for candidate ${String(answer.candidate).slice(0, 7)}${why}${shown}\n\n${block}`;
}

/** The answer of a comment (only its last block counts), null without a block; throws on a malformed one. */
export function parseAnswer(body) {
  const text = String(body ?? "");
  const start = text.lastIndexOf(OPEN);
  if (start === -1) return null;
  const end = text.indexOf(CLOSE, start + OPEN.length);
  if (end === -1) throw new Error(`The kj-release answer block is not closed by "${CLOSE}"`);
  let answer;
  try {
    answer = JSON.parse(text.slice(start + OPEN.length, end).trim());
  } catch (error) {
    throw new Error(`The kj-release answer block is not valid JSON: ${error.message}`, { cause: error });
  }
  if (!DECISIONS.includes(answer?.decision)) throw new Error(`The kj-release answer has no valid decision (${DECISIONS.join("|")})`);
  return answer;
}

const failed = (answer) => answer.check?.suite === "fail" || answer.check?.lane === "fail";

function countedAnswers({ proposal, comments }) {
  const latest = new Map();
  const ignored = [];
  for (const { login, body } of comments) {
    let answer;
    try {
      answer = parseAnswer(body);
    } catch (error) {
      ignored.push({ login, reason: error.message });
      continue;
    }
    if (!answer) continue;
    if (!proposal.participants.includes(login)) ignored.push({ login, reason: "not a participant" });
    else if (answer.candidate === proposal.candidate) latest.set(login, answer);
    else ignored.push({ login, reason: "answers another candidate" });
  }
  return { latest, ignored };
}

/** @returns {{ ready: boolean, expired: boolean, confirmed: string[], holds: {login: string, decision: string, why: string}[], silent: string[], ignored: object[] }} */
export function evaluateRelease({ proposal, comments, now }) {
  const { latest, ignored } = countedAnswers({ proposal, comments });
  const confirmed = [];
  const holds = [];
  for (const [login, answer] of latest) {
    if (answer.decision === "ok" && !failed(answer)) confirmed.push(login);
    else holds.push({ login, decision: answer.decision, why: answer.decision === "ok" ? "its own check failed" : (answer.why ?? "") });
  }
  const silent = proposal.participants.filter((login) => !latest.has(login));
  const expired = now >= Date.parse(proposal.deadline);
  return { ready: holds.length === 0 && (silent.length === 0 || expired), expired, confirmed, holds, silent, ignored };
}
