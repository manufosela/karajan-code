export * from "./github-board.js";
import { createGithubManager } from "./manager.js";

export { createGithubManager };
/** The uniform entry of a manager package (HU-3336): `config` is the manager's block of board.yml; gh holds the login, so `env` is unused. */
export const createManager = ({ config, run, board }) => createGithubManager({ repo: config.repo, run, board });
