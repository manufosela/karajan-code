// HU-3352: the core paths keep serving the story-contract package, and the errors stay reachable from the GitHub module.
import { describe, it, expect } from "vitest";
import * as neutral from "../../src/hu/board-errors.js";
import * as github from "../../src/hu/github-board.js";
import * as contract from "../../src/hu/story-contract.js";
import * as pkg from "../../packages/story-contract/src/index.js";

describe("core paths over the story-contract package", () => {
  it("re-export the contract and the errors of the package unchanged", () => {
    for (const name of Object.keys(contract)) expect(contract[name]).toBe(pkg[name]);
    for (const name of Object.keys(neutral)) expect(neutral[name]).toBe(pkg[name]);
    for (const name of ["BoardOfflineError", "BoardRejectedError", "HuClaimedError", "isOffline", "isRefusal"]) {
      // The package keeps its own copy of the errors for now: same name, not the same identity.
      expect(github[name].name).toBe(neutral[name].name);
    }
  });
});
