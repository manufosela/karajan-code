// HU-3333: the contract's own checks, and the neutral errors staying reachable from the GitHub module.
import { describe, it, expect } from "vitest";
import * as neutral from "../../src/hu/board-errors.js";
import * as github from "../../src/hu/github-board.js";
import { assertManager, describeCapabilities, missingCredentials, OPERATIONS } from "../../src/hu/story-contract.js";

const capabilities = { acceptanceCriteria: "body", dependencies: "partial", assignee: true, verdicts: "pr", offline: true };

describe("assertManager", () => {
  const complete = { ...Object.fromEntries(OPERATIONS.map((op) => [op, async () => ({})])), capabilities, credentials: [] };
  it("accepts a manager with the four operations", () => {
    expect(OPERATIONS).toEqual(["create", "list", "move", "claim"]);
    expect(() => assertManager(complete)).not.toThrow();
  });
  it("names the operation that is missing", () => {
    expect(() => assertManager({ ...complete, move: undefined })).toThrow(/move/);
    expect(() => assertManager(null)).toThrow(/manager/);
  });
  it("fails loud on capabilities that are missing, incomplete or unknown", () => {
    expect(() => assertManager({ ...complete, capabilities: undefined })).toThrow(/capabilities/);
    expect(() => assertManager({ ...complete, capabilities: { ...capabilities, verdicts: undefined } })).toThrow(/verdicts/);
    expect(() => assertManager({ ...complete, capabilities: { ...capabilities, dependencies: "some" } })).toThrow(/dependencies.*"some"/);
    expect(() => assertManager({ ...complete, capabilities: { ...capabilities, assignee: "yes" } })).toThrow(/assignee/);
  });
  it("takes credentials as a list of variable names, or none", () => {
    expect(() => assertManager({ ...complete, credentials: undefined })).not.toThrow();
    expect(() => assertManager({ ...complete, credentials: "LINEAR_API_KEY" })).toThrow(/credentials/);
    expect(() => assertManager({ ...complete, credentials: [""] })).toThrow(/credentials/);
  });
});

describe("describeCapabilities", () => {
  it("splits what a manager can do from what it cannot, each missing one pointing to the HU Board", () => {
    const { can, cannot } = describeCapabilities({ capabilities });
    expect(can).toEqual(["acceptance criteria in the story body", "some dependencies between stories", "who holds a story", "review verdicts on the PR", "work offline through the core cache"]);
    expect(cannot).toEqual(["the full dependency graph"]);
  });
  it("lists every missing capability", () => {
    const { can, cannot } = describeCapabilities({ capabilities: { acceptanceCriteria: "field", dependencies: "none", assignee: false, verdicts: "none", offline: false } });
    expect(can).toEqual(["acceptance criteria in their own field"]);
    expect(cannot).toEqual(["the full dependency graph", "who holds a story", "review verdicts", "work offline through the core cache"]);
  });
});

describe("missingCredentials", () => {
  it("names the unset variables and never reads a value into its answer", () => {
    expect(missingCredentials({ credentials: ["A_KEY", "B_KEY", "C_KEY"] }, { A_KEY: "secret", C_KEY: "" })).toEqual(["B_KEY", "C_KEY"]);
    expect(missingCredentials({}, {})).toEqual([]);
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
