// KJC-TSK-1417 step 3a: the Planning Game manager reads a card as a story, creates cards with the
// fields the owner decided (story, points, epic, validator) and claims them for a developer.
import { describe, expect, it } from "vitest";
import { createPlanningGameManager } from "../src/manager.js";
import { fakePg } from "./fake-pg.js";

const config = { server: "pg", project: "KJC", epic: "KJC-PCS-0026", developer: "dev_016", validator: "stk_001", users: { alice: "dev_001", bob: "dev_002" } };
const make = () => { const pg = fakePg(); return { pg, manager: createPlanningGameManager({ config, client: pg.client }) }; };
const story = { as: "Como usuario", want: "Quiero entrar con SSO", so: "Para no recordar otra clave" };

describe("planning-game manager: read, create, claim", () => {
  it("creates a To Do card in the epic with the story, criteria, tests, points and ref, and reads it as pending", async () => {
    const { pg, manager } = make();
    const hu = await manager.create({ title: "Login with SSO", acceptanceCriteria: ["redirects"], tests: ["e2e"], ref: "HU-9", story, devPoints: 3, businessPoints: 4 });
    expect(hu).toEqual({ short_id: "KJC-TSK-0001", title: "Login with SSO", status: "pending", claimed_by: null, ref: "HU-9", url: null });
    expect(pg.cards.get("KJC-TSK-0001")).toMatchObject({
      epic: "KJC-PCS-0026", validator: "stk_001", devPoints: 3, businessPoints: 4, notes: "Ref: HU-9",
      acceptanceCriteria: "redirects\nTest: e2e", descriptionStructured: [{ role: story.as, goal: story.want, benefit: story.so }],
    });
  });

  it("a card validated or reopened reads as done or running; any other unknown state is refused", async () => {
    const { pg, manager } = make();
    const { short_id } = await manager.create({ title: "t" });
    pg.cards.get(short_id).status = "Done&Validated";
    expect(await manager.read(short_id)).toMatchObject({ status: "done" });
    pg.cards.get(short_id).status = "Reopened";
    expect(await manager.read(short_id)).toMatchObject({ status: "running" });
    pg.cards.get(short_id).status = "Archived";
    await expect(manager.read(short_id)).rejects.toMatchObject({ name: "BoardRejectedError", message: expect.stringMatching(/"Archived".*does not guess/) });
  });

  it("claims a card for the developer of a kj identity, and names who holds it", async () => {
    const { pg, manager } = make();
    const { short_id } = await manager.create({ title: "t" });
    expect(await manager.claim(short_id, "alice")).toMatchObject({ claimed_by: "alice" });
    expect(pg.cards.get(short_id).developer).toBe("dev_001");
    pg.cards.get(short_id).status = "In Progress";
    await expect(manager.claim(short_id, "bob")).rejects.toMatchObject({ name: "HuClaimedError" });
    expect(await manager.claim(short_id, "bob", { release: true })).toMatchObject({ claimed_by: "bob" });
    await expect(manager.claim(short_id, "carol")).rejects.toMatchObject({ name: "BoardRejectedError", message: expect.stringMatching(/carol.*planning-game.users/) });
    // A reopened card is being worked again: its holder keeps it too.
    pg.cards.get(short_id).status = "Reopened";
    await expect(manager.claim(short_id, "alice")).rejects.toMatchObject({ name: "HuClaimedError" });
  });

  it("a card of another project is not its to touch", async () => {
    const { manager } = make();
    expect(manager.isId("KJC-TSK-0042")).toBe(true);
    expect(manager.isId("PLN-TSK-0042")).toBe(false);
    await expect(manager.read("PLN-TSK-0042")).rejects.toMatchObject({ name: "BoardRejectedError", message: expect.stringMatching(/not a KJC task/) });
  });
});
