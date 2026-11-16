// KJC-TSK-1651 (ADR 0059): `kj continuation gate --transcript <path>`, invoked by the Sentinel stop hook.
// Exit 2 holds the turn (method_gates.continuation: block, the default); warn reports; off is silent.
import { judgeStop, runningBackground, sessionCards, settleWithBoard } from "../continuation/gate.js";
import { listHandoffs } from "../harden/handoff.js";
import { readEntries, readTurn } from "../claims/turn.js";
import { listPlans, loadPlan } from "../plan/plan-store.js";
import { readIdentity } from "../identity/store.js";
import { effectiveGitEmail } from "../identity/detect.js";

/** KJC-BUG-0622: the cards kj keeps on this machine (local plans and the shared board's mirror), no network. */
async function localBoard(projectDir) {
  const board = new Map();
  for (const meta of await listPlans(projectDir)) {
    const plan = await loadPlan(projectDir, meta.planId);
    for (const h of plan?.hus ?? []) board.set(h.short_id || h.id, { status: h.status, claimed_by: h.claimed_by ?? null });
  }
  return board;
}

// Who works this clone, as kj hu start reserves a card to it.
const workerOf = (projectDir) => readIdentity(projectDir)?.gh_user || effectiveGitEmail(projectDir) || null;

function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((b) => b?.text ?? "").join("\n");
  return "";
}

/** The transcript as ordered texts: kj's outputs, what reaches the agent as the user, what it said. */
function transcriptTexts(entries) {
  const texts = [];
  for (const entry of entries) {
    const content = entry?.message?.content;
    const parts = Array.isArray(content) ? content : [{ type: "text", text: content }];
    for (const part of parts) {
      if (part?.type === "tool_result") texts.push({ kind: "output", text: textOf(part.content) });
      else if (part?.type === "text" && typeof part.text === "string") texts.push({ kind: entry.type === "assistant" ? "assistant" : "user", text: part.text });
    }
  }
  return texts;
}

export async function continuationGateCommand({ flags = {}, config = {}, logger = console, handoffsFn = listHandoffs, boardFn = localBoard, whoFn = workerOf } = {}) {
  const mode = config?.method_gates?.continuation ?? "block";
  if (mode !== "warn" && mode !== "block") return 0;
  let verdict;
  try {
    const projectDir = config?.projectDir ?? process.cwd();
    const texts = transcriptTexts(readEntries(flags.transcript));
    const handoffsOpen = handoffsFn({ projectDir }).some((h) => h.status === "pending");
    const cards = settleWithBoard(sessionCards(texts), await boardFn(projectDir), whoFn(projectDir));
    verdict = judgeStop({ text: readTurn(flags.transcript).text, cards, handoffsOpen, background: runningBackground(texts) });
  } catch {
    return 0; // not observable: a gate that cannot read its inputs gets out of the way
  }
  if (!verdict.hold) return 0;
  logger.error(`kj continuation: ${verdict.reason}`);
  return mode === "block" ? 2 : 0;
}
