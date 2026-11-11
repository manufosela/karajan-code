/**
 * EXPERIMENTAL (HU-3792, ADR 0043, issue #3236): what an adapter over a project's git system offers so
 * the agents of different people can exchange messages. A second interface of this package, apart from
 * the story one: a manager that does not implement it simply reports every message capability absent.
 * No operation or doc here names a concept of one system: thread, card, change and conversation are ours.
 *
 *   publish(thread, message)         -> { id, author, serverTime }   (id is stable; time is the server's)
 *   listSince(thread, cursor)        -> { messages: [{ id, author, createdAt, modifiedAt, body }], cursor }
 *   readAssignee(card)               -> string | null
 *   readReviewers(change)            -> [{ user, state }]            (review state of each requested reviewer)
 *   setLabel(card, label, on)        -> void
 *   readLabels(card)                 -> string[]
 *   authorPermission(user)           -> "none" | "read" | "write" | "admin"   (for the project)
 *   openConversation(kind, title)    -> thread, one kind per ceremony
 *   listConversations(kind)          -> thread[]
 *   limits()                         -> { minPollIntervalMs, minWritePauseMs, quotaLeft }
 * Declared by the adapter: `capabilities` (all booleans) and `guarantees` ({ stableMessageId, serverTime }).
 */
export const MESSAGE_OPERATIONS = ["publish", "listSince", "readAssignee", "readReviewers", "setLabel", "readLabels", "authorPermission", "openConversation", "listConversations", "limits"];
export const MESSAGE_CAPABILITIES = ["tasks", "reviews", "labels", "ceremonies", "notice", "edit_history"];
export const PERMISSIONS = ["none", "read", "write", "admin"];
/** The adapter cannot give something the rules of use depend on (ADR 0043 item 7): it cannot be used. */
export class MessageGuaranteeError extends Error { name = "MessageGuaranteeError"; }
const hasInterface = (m) => m !== null && typeof m === "object" && MESSAGE_OPERATIONS.every((op) => typeof m[op] === "function");
/** What the adapter supports; every capability is false for a manager without the message interface (never an error). */
export function messageCapabilities(manager) {
  const declared = hasInterface(manager) ? (manager.capabilities ?? {}) : {};
  return Object.fromEntries(MESSAGE_CAPABILITIES.map((name) => [name, declared[name] === true]));
}
/** Fail loud, naming what is missing: the operations, the three required guarantees, the capability values. */
export function assertMessageAdapter(adapter) {
  if (adapter === null || typeof adapter !== "object") throw new TypeError("message adapter must be an object with the message operations");
  if (typeof adapter.authorPermission !== "function") throw new MessageGuaranteeError("message adapter cannot give authorPermission: the rules of use depend on it");
  if (adapter.guarantees?.stableMessageId !== true) throw new MessageGuaranteeError("message adapter cannot give a stable message id: the rules of use depend on it");
  if (adapter.guarantees?.serverTime !== true) throw new MessageGuaranteeError("message adapter cannot give a server time: the rules of use depend on it");
  const missing = MESSAGE_OPERATIONS.filter((op) => typeof adapter[op] !== "function");
  if (missing.length > 0) throw new TypeError(`message adapter is missing ${missing.join(", ")}: it must offer ${MESSAGE_OPERATIONS.join(", ")}`);
  for (const [name, value] of Object.entries(adapter.capabilities ?? {})) {
    if (!MESSAGE_CAPABILITIES.includes(name)) throw new TypeError(`message adapter capability ${name} is unknown: use ${MESSAGE_CAPABILITIES.join(", ")}`);
    if (typeof value !== "boolean") throw new TypeError(`message adapter capability ${name} is ${JSON.stringify(value)}: it must be true or false`);
  }
}
