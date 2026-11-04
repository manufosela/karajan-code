/**
 * HU-3333 (epic #3332, ADR 0029): what every task manager (GitHub Issues, Linear...) must offer.
 *
 *   create({ title, acceptanceCriteria, tests, ref }) -> Hu
 *   list()                      -> Hu[]
 *   move(id, status)            -> Hu     (read back after writing)
 *   claim(id, who, { release }) -> Hu
 *
 * Optional, the id format of the manager (the core never assumes HU-<n>):
 *   isId(ref)        -> boolean  (is this text one of my ids; no manager matching = refused loud)
 *   canonicalId(ref) -> string   (the id as list() returns it; default: the ref as typed)
 *   idHint           -> string   (how an id looks, for messages)
 */
export const OPERATIONS = ["create", "list", "move", "claim"];
/** The fields of an Hu, whatever manager it comes from. */
export const HU_FIELDS = ["short_id", "title", "status", "claimed_by", "ref"];

/** Fail loud, naming what is missing, instead of at the first call that needs it. */
export function assertManager(manager) {
  if (manager === null || typeof manager !== "object") throw new TypeError("task manager must be an object with the story operations");
  const missing = OPERATIONS.filter((op) => typeof manager[op] !== "function");
  if (missing.length > 0) throw new TypeError(`task manager is missing ${missing.join(", ")}: it must offer ${OPERATIONS.join(", ")}`);
}
