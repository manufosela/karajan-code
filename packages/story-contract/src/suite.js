// HU-3333 (epic #3332): the behaviour every task manager must show behind the story contract.
// `makeManager()` returns { manager, backend }: the manager under test and a fake of the service
// it talks to, with `backend.rejectMoves()` (writes of a status are silently dropped) and
// `backend.corrupt(shortId, n)` (the story ends up with n status labels, as if edited by hand).
import { describe, it, expect } from "vitest";
import { assertManager, CAPABILITY_VALUES, HU_FIELDS } from "./story-contract.js";

export function runStoryContract(name, makeManager) {
  describe(`story contract: ${name}`, () => {
    const setup = () => {
      const made = makeManager();
      assertManager(made.manager);
      return made;
    };

    it("declares valid capabilities and credentials", () => {
      const { manager } = setup();
      const sortedKeys = (obj) => Object.keys(obj).toSorted((a, b) => a.localeCompare(b));
      expect(sortedKeys(manager.capabilities)).toEqual(sortedKeys(CAPABILITY_VALUES));
      expect(Array.isArray(manager.credentials ?? [])).toBe(true);
    });

    it("creates a pending Hu with the contract's shape and lists it", async () => {
      const { manager } = setup();
      const hu = await manager.create({ title: "Login with SSO", acceptanceCriteria: ["redirects"], tests: ["e2e"], ref: "KJC-TSK-9" });
      expect(hu).toMatchObject({ title: "Login with SSO", status: "pending" });
      expect(Object.keys(hu)).toEqual(expect.arrayContaining(HU_FIELDS));
      const listed = (await manager.list()).find((h) => h.short_id === hu.short_id);
      expect(listed).toMatchObject({ title: "Login with SSO", status: "pending", claimed_by: null, ref: "KJC-TSK-9" });
    });

    it("moves an Hu and reads it back", async () => {
      const { manager } = setup();
      const { short_id } = await manager.create({ title: "t" });
      expect(await manager.move(short_id, "running")).toMatchObject({ short_id, status: "running" });
      expect((await manager.list()).find((h) => h.short_id === short_id).status).toBe("running");
    });

    it("throws BoardRejectedError when the backend disagrees with the move", async () => {
      const { manager, backend } = setup();
      const { short_id } = await manager.create({ title: "t" });
      backend.rejectMoves();
      await expect(manager.move(short_id, "running")).rejects.toMatchObject({ name: "BoardRejectedError" });
    });

    it("keeps a running Hu with its holder unless the other user releases it", async () => {
      const { manager } = setup();
      const { short_id } = await manager.create({ title: "t" });
      await manager.claim(short_id, "alice");
      await manager.move(short_id, "running");
      await expect(manager.claim(short_id, "bob")).rejects.toMatchObject({ name: "HuClaimedError" });
      expect(await manager.claim(short_id, "bob", { release: true })).toMatchObject({ short_id, claimed_by: "bob" });
    });

    it("leaves one holder when two users claim at once", async () => {
      const { manager } = setup();
      const { short_id } = await manager.create({ title: "t" });
      const results = await Promise.allSettled([manager.claim(short_id, "alice"), manager.claim(short_id, "bob")]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      const holder = (await manager.list()).find((h) => h.short_id === short_id).claimed_by;
      expect(["alice", "bob"]).toContain(holder);
    });

    it.each([0, 2])("refuses loud an Hu with %i status labels", async (n) => {
      const { manager, backend } = setup();
      const { short_id } = await manager.create({ title: "t" });
      backend.corrupt(short_id, n);
      await expect(manager.list()).rejects.toMatchObject({ name: "BoardRejectedError" });
    });
  });
}
