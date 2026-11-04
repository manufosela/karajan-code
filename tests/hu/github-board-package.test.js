// HU-3353: the core paths keep serving the board-github package.
import { it, expect } from "vitest";
import * as board from "../../src/hu/github-board.js";
import * as manager from "../../src/hu/managers/github/index.js";
import * as pkg from "../../packages/board-github/src/index.js";

it("re-exports the board functions and the manager of the package unchanged", () => {
  for (const name of Object.keys(board)) expect(board[name]).toBe(pkg[name]);
  expect(manager.createGithubManager).toBe(pkg.createGithubManager);
  expect(Object.keys(manager)).toEqual(["createGithubManager"]);
});
