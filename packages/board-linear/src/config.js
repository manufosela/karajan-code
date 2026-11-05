// Validation of the `linear` block of board.yml. Credentials never live there: they come from LINEAR_API_KEY.
import { BoardRejectedError } from "./board-errors.js";

const STATUSES = ["pending", "running", "done", "failed", "skipped"];
const KNOWN = ["team", "label", "states", "users"];
const fail = (msg) => { throw new BoardRejectedError(`board.yml linear: ${msg}`); };
const text = (v) => typeof v === "string" && v.trim() !== "";

export function validateConfig(block) {
  if (!block || typeof block !== "object") fail("the linear block is missing");
  for (const k of Object.keys(block)) {
    if (/key|token|secret|password/i.test(k)) fail(`"${k}" is not allowed: credentials come from the LINEAR_API_KEY environment variable, never from board.yml`);
    if (!KNOWN.includes(k)) fail(`unknown key "${k}" (allowed: ${KNOWN.join(", ")})`);
  }
  if (!text(block.team)) fail("linear.team is required (the team key, e.g. TRI)");
  const states = block.states ?? {};
  const missing = STATUSES.filter((s) => !text(states[s]));
  if (missing.length) fail(`linear.states needs a state name for each of: ${missing.join(", ")}`);
  const users = block.users ?? {};
  if (typeof users !== "object" || Array.isArray(users)) fail("linear.users must be a map of kj identity to email");
  for (const [who, email] of Object.entries(users)) if (!text(email)) fail(`linear.users.${who} needs an email`);
  return { team: block.team, label: text(block.label) ? block.label : "kj:hu", states: Object.fromEntries(STATUSES.map((s) => [s, states[s]])), users };
}
