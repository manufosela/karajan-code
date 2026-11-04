/**
 * HU-3394 (epic #3332): `write` and `assertNotHeld` are optional optimisations of a task manager.
 * The contract is create, list, move, claim; a manager that has only those still works in the core:
 *  - `write` (the writes without the read-back) defaults to the contract's own move and claim;
 *  - `assertNotHeld` defaults to one `list()` and the same refusal GitHub gives.
 */
const heldError =(id, holders) =>
  Object.assign(new Error(`${id} is held by ${holders.join(", ")}: taking it over is explicit (release)`), { name: "HuClaimedError" });

/** A running card held by someone other than `who` is theirs: any move of it needs release. */
const defaultAssertNotHeld = (manager) => async (id, who) => {
  const card = (await manager.list()).find((h) => h.short_id === id);
  const holders = [card?.claimed_by].flat().filter((h) => h && h !== who);
  if (card?.status === "running" && holders.length > 0) throw heldError(id, holders);
};

export function withManagerDefaults(manager) {
  return Object.assign(Object.create(manager), {
    write: manager.write ?? { move: (...a) => manager.move(...a), claim: (...a) => manager.claim(...a) },
    assertNotHeld: manager.assertNotHeld ?? defaultAssertNotHeld(manager),
  });
}
