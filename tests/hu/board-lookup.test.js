// KJC-BUG-0454: `kj code --card` looked for the card in the old kj run store, so
// any card `kj hu add` created was "not found". It reads the same board as `kj hu`.
import { describe, it, expect, vi } from "vitest";
import { findBoardHu } from "../../src/hu/board-lookup.js";

const plan = { planId: "p1", hus: [{ id: "x-1", short_id: "HU-0007", title: "Local card", status: "pending", acceptance_criteria: ["Given a", "Then b"], scope: "src/a.js" }] };
const local = { boardConfig: async () => ({ backend: "local" }), listPlans: async () => [{ planId: "p1" }], loadPlan: async () => plan };

describe("findBoardHu", () => {
  it("finds a local card by its short id or its id", async () => {
    expect(await findBoardHu("/x", "HU-0007", local)).toMatchObject({ title: "Local card", acceptance_criteria: ["Given a", "Then b"] });
    expect((await findBoardHu("/x", "x-1", local)).short_id).toBe("HU-0007");
  });

  it("a card on the shared board comes from GitHub, as kj hu list reads it", async () => {
    const listTeamHus = vi.fn(async () => [{ short_id: "HU-2891", number: 2891, title: "Shared card", status: "running", ref: "KJC-TSK-1324" }]);
    const deps = { ...local, boardConfig: async () => ({ backend: "github", repo: "acme/app" }), pinGhIdentity: () => {}, listTeamHus, cache: { list: async ({ list, repo }) => ({ rows: await list({ repo }) }) } };
    expect(await findBoardHu("/x", "HU-2891", deps)).toMatchObject({ short_id: "HU-2891", title: "Shared card", status: "running" });
  });

  it("a card on no board fails loudly, naming kj hu list", async () => {
    await expect(findBoardHu("/x", "HU-404", local)).rejects.toThrow(/HU-404 is not on the HU Board.*kj hu list/);
  });
});
