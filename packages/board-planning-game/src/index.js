// The Planning Game manager of the story contract (KJC-TSK-1417): config and error helpers so far.
export { kjStatusOf, validateConfig } from "./config.js";
export { BoardOfflineError, BoardRejectedError, HuClaimedError, isOffline, isRefusal } from "./board-errors.js";
