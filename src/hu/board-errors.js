/**
 * HU-3333 (epic #3332): the errors every task manager raises, in a file that belongs to none of them.
 * The `name` values are matched by callers (err.name), so they never change.
 */

/** The service could not be reached: the caller may queue the change, never invent data. */
export class BoardOfflineError extends Error { name = "BoardOfflineError"; }
/** The service answered and said no (permissions, missing repo...). */
export class BoardRejectedError extends Error { name = "BoardRejectedError"; }
/** The HU is running and someone else holds it: taking it over is explicit (release). */
export class HuClaimedError extends Error { name = "HuClaimedError"; }

// KJC-TSK-1165: by name, not only instanceof: a test runner may load this module twice.
export const isOffline = (err) => err instanceof BoardOfflineError || err?.name === "BoardOfflineError";
/** The service answered and refused (rejected, or the HU is held by someone else): a conflict, not a failure of kj. */
export const isRefusal = (err) => err instanceof BoardRejectedError || err instanceof HuClaimedError || ["BoardRejectedError", "HuClaimedError"].includes(err?.name);
