// Temporary copy of story-contract's board-errors.js until that package is published and declared as a dependency; across packages, check errors by err.name (isOffline/isRefusal), never by instanceof.
/** The service could not be reached: the caller may queue the change, never invent data. */
export class BoardOfflineError extends Error { name = "BoardOfflineError"; }
/** The service answered and said no (permissions, missing repo...). */
export class BoardRejectedError extends Error { name = "BoardRejectedError"; }
/** The HU is running and someone else holds it: taking it over is explicit (release). */
export class HuClaimedError extends Error { name = "HuClaimedError"; }
// By name, not only instanceof: a test runner may load this module twice, and the core holds another copy.
export const isOffline = (err) => err instanceof BoardOfflineError || err?.name === "BoardOfflineError";
/** The service answered and refused (rejected, or the HU is held by someone else): a conflict, not a failure of kj. */
export const isRefusal = (err) => err instanceof BoardRejectedError || err instanceof HuClaimedError || ["BoardRejectedError", "HuClaimedError"].includes(err?.name);
