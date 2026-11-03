// HU-3333: the contract's own checks, and the neutral errors staying reachable from the GitHub module.
import { describe, it, expect } from "vitest";
import * as neutral from "../../src/hu/board-errors.js";
import * as github from "../../src/hu/github-board.js";
import { assertManager, OPERATIONS } from "../../src/hu/story-contract.js";

describe("assertManager", () => {
  const complete = Object.fromEntries(OPERATIONS.map((op) => [op, async () => ({})]));
  it("accepts a manager with the four operations", () => {
    expect(OPERATIONS).toEqual(["create", "list", "move", "claim"]);
    expect(() => assertManager(complete)).not.toThrow();
  });
  it("names the operation that is missing", () => {
    expect(() => assertManager({ ...complete, move: undefined })).toThrow(/move/);
    expect(() => assertManager(null)).toThrow(/manager/);
  });
});

describe("board errors", () => {
  it("are the same classes from both modules, with their names unchanged", () => {
    for (const name of ["BoardOfflineError", "BoardRejectedError", "HuClaimedError", "isOffline", "isRefusal"]) {
      expect(github[name]).toBe(neutral[name]);
    }
    expect(new neutral.HuClaimedError("x").name).toBe("HuClaimedError");
    expect(new neutral.BoardRejectedError("x").name).toBe("BoardRejectedError");
    expect(new neutral.BoardOfflineError("x").name).toBe("BoardOfflineError");
  });
});
