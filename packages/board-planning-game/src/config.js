// KJC-TSK-1417: the `planning-game` block of board.yml. The Planning Game is reached only through its
// MCP server (the owner's decision), named here as the host's MCP configuration names it, so its
// authentication and its transition rules stay the Planning Game's. Credentials never live here.
import { BoardRejectedError } from "./board-errors.js";

const STATUSES = ["pending", "running", "done", "failed", "skipped"];
// The Planning Game's task states; its MCP cannot set Done&Validated (only a validator can).
const DEFAULT_STATES = { pending: "To Do", running: "In Progress", done: "To Validate", failed: "Blocked", skipped: "Pausado" };
const KNOWN = ["server", "project", "epic", "developer", "validator", "states", "users"];
const fail = (msg) => { throw new BoardRejectedError(`board.yml planning-game: ${msg}`); };
const text = (v) => typeof v === "string" && v.trim() !== "";
const required = (block, key, hint) => { if (!text(block[key])) fail(`planning-game.${key} is required (${hint})`); };

export function validateConfig(block) {
  if (!block || typeof block !== "object") fail("the planning-game block is missing");
  for (const k of Object.keys(block)) {
    if (/key|token|secret|password/i.test(k)) fail(`"${k}" is not allowed: credentials stay in the Planning Game's MCP server, never in board.yml`);
    if (!KNOWN.includes(k)) fail(`unknown key "${k}" (allowed: ${KNOWN.join(", ")})`);
  }
  required(block, "server", "the MCP server's name in the host's MCP configuration, e.g. planning-game-personal");
  required(block, "project", "the Planning Game project, e.g. KJC");
  required(block, "epic", "the epic new cards go to, e.g. KJC-PCS-0026");
  if (!/^dev_\w+$/.test(block.developer ?? "")) fail("planning-game.developer must be a developer id (dev_...)");
  if (!/^stk_\w+$/.test(block.validator ?? "")) fail("planning-game.validator must be a stakeholder id (stk_...)");
  const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const declared = "states" in block ? block.states : {};
  if (!isMap(declared)) fail("planning-game.states must be a map of kj status to Planning Game state");
  for (const s of Object.keys(declared)) if (!STATUSES.includes(s)) fail(`planning-game.states: unknown kj status "${s}" (allowed: ${STATUSES.join(", ")})`);
  const states = { ...DEFAULT_STATES, ...declared };
  for (const s of STATUSES) if (!text(states[s])) fail(`planning-game.states.${s} needs a Planning Game state`);
  for (const [i, s] of STATUSES.entries()) {
    const other = STATUSES.slice(i + 1).find((t) => states[t] === states[s]);
    if (other) fail(`planning-game.states: ${s} and ${other} both map to "${states[s]}": each kj status needs its own state, or reading it back is a guess`);
  }
  const users = "users" in block ? block.users : {};
  if (!isMap(users)) fail("planning-game.users must be a map of kj identity to developer id");
  for (const [who, dev] of Object.entries(users)) if (!/^dev_\w+$/.test(String(dev))) fail(`planning-game.users.${who} must be a developer id (dev_...)`);
  const { server, project, epic, developer, validator } = block;
  return { server, project, epic, developer, validator, states: Object.fromEntries(STATUSES.map((s) => [s, states[s]])), users };
}

/** The kj status of a Planning Game state, or null when no kj status maps to it (kj does not guess). */
export const kjStatusOf = (pgState, states) => STATUSES.find((s) => states[s] === pgState) ?? null;
