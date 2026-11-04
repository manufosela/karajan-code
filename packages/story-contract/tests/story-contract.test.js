// The contract's own checks, and a fake in-memory manager passing the shared suite.
import { describe, it, expect } from "vitest";
import { assertManager, describeCapabilities, missingCredentials, OPERATIONS, BoardRejectedError, HuClaimedError } from "../src/index.js";
import { runStoryContract } from "../src/suite.js";

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
    expect(() => assertManager({ ...complete, capabilities: { ...capabilities, dependencies: "some" } })).toThrow(/dependencies.*"some"/);
  });
  it("takes credentials as a list of variable names, or none", () => {
    expect(() => assertManager({ ...complete, credentials: undefined })).not.toThrow();
    expect(() => assertManager({ ...complete, credentials: [""] })).toThrow(/credentials/);
  });
});

describe("describeCapabilities and missingCredentials", () => {
  it("splits what a manager can do from what it cannot", () => {
    const { can, cannot } = describeCapabilities({ capabilities });
    expect(can).toContain("review verdicts on the PR");
    expect(cannot).toEqual(["the full dependency graph"]);
  });
  it("names the unset variables and never reads a value", () => {
    expect(missingCredentials({ credentials: ["A_KEY", "B_KEY"] }, { A_KEY: "secret" })).toEqual(["B_KEY"]);
  });
});

// A manager that keeps its stories in memory: what a manager author's own test looks like.
const makeFakeManager = () => {
  const stories = new Map();
  let rejecting = false;
  const manager = {
    capabilities,
    credentials: [],
    create: async ({ title, ref = null }) => {
      const hu = { short_id: `S-${stories.size + 1}`, title, status: "pending", claimed_by: null, ref, labels: 1 };
      stories.set(hu.short_id, hu);
      return { ...hu };
    },
    list: async () => {
      for (const s of stories.values()) if (s.labels !== 1) throw new BoardRejectedError(`${s.short_id} has ${s.labels} status labels`);
      return [...stories.values()].map((s) => ({ ...s }));
    },
    move: async (id, status) => {
      if (!rejecting) stories.get(id).status = status;
      const hu = (await manager.list()).find((s) => s.short_id === id);
      if (hu.status !== status) throw new BoardRejectedError(`${id} stayed ${hu.status}`);
      return hu;
    },
    claim: async (id, who, { release = false } = {}) => {
      const s = stories.get(id);
      if (s.claimed_by && s.claimed_by !== who && s.status === "running" && !release) throw new HuClaimedError(`${id} is held by ${s.claimed_by}`);
      s.claimed_by = who;
      return { ...s };
    },
  };
  const backend = { rejectMoves: () => (rejecting = true), corrupt: (id, n) => (stories.get(id).labels = n) };
  return { manager, backend };
};

runStoryContract("in-memory fake", makeFakeManager);
