// KJC-TSK-1417 step 3b: moving a card fills what each Planning Game transition asks for: the day's
// sprint, the developer and the start date to work it; the commits and the PR to finish it; the
// reason to block it. The Planning Game still judges the move, and the manager reads it back.
import { describe, expect, it } from "vitest";
import { createPlanningGameManager } from "../src/manager.js";
import { fakePg } from "./fake-pg.js";

const config = { server: "pg", project: "KJC", epic: "KJC-PCS-0026", developer: "dev_016", validator: "stk_001" };
const now = () => new Date("2026-11-05T10:00:00Z");
const commits = [{ hash: "abc1234", message: "feat: x (KJC-TSK-0001)", date: "2026-11-05T09:00:00Z", author: "manufosela" }];
const pr = { prUrl: "https://github.com/acme/app/pull/7", prNumber: 7, date: "2026-11-05T09:30:00Z" };
const make = (evidence = async () => ({ commits, pr })) => {
  const pg = fakePg();
  pg.sprints = [];
  pg.tools.list_sprints = () => [...pg.sprints, { _truncated: true, _totalItems: 117 }];
  pg.tools.create_sprint = ({ title }) => ({ cardId: "KJC-SPR-0118", title });
  return { pg, manager: createPlanningGameManager({ config, client: pg.client, now, evidence }) };
};

describe("planning-game manager: move", () => {
  it("to running fills the day's sprint, the developer and the start date, and reads it back", async () => {
    const { pg, manager } = make();
    const { short_id } = await manager.create({ title: "t" });
    expect(await manager.move(short_id, "running")).toMatchObject({ short_id, status: "running", claimed_by: "dev_016" });
    expect(pg.cards.get(short_id)).toMatchObject({ status: "In Progress", sprint: "KJC-SPR-0118", developer: "dev_016", startDate: "2026-11-05" });
    expect(pg.calls.find((c) => c.tool === "create_sprint").args).toMatchObject({ projectId: "KJC", title: "Sprint 118 - 20261105", startDate: "2026-11-05", endDate: "2026-11-05" });
  });

  it("to done carries the end date, the commits and the PR of the card", async () => {
    const { pg, manager } = make();
    const { short_id } = await manager.create({ title: "t" });
    await manager.move(short_id, "running");
    expect(await manager.move(short_id, "done")).toMatchObject({ status: "done" });
    expect(pg.cards.get(short_id)).toMatchObject({ status: "To Validate", endDate: "2026-11-05", commits, pipelineStatus: { prCreated: pr } });
  });

  it("to done without commits or a PR is refused before writing, naming what is missing", async () => {
    const { pg, manager } = make(async () => ({ commits: [], pr: null }));
    const { short_id } = await manager.create({ title: "t" });
    await expect(manager.move(short_id, "done")).rejects.toMatchObject({ name: "BoardRejectedError", message: expect.stringMatching(/no commit.*no merged PR/) });
    expect(pg.cards.get(short_id).status).toBe("To Do");
  });

  it("to failed blocks it with the reason; a move the Planning Game does not apply is refused", async () => {
    const { pg, manager } = make();
    const { short_id } = await manager.create({ title: "t" });
    await manager.move(short_id, "failed");
    expect(pg.cards.get(short_id)).toMatchObject({ status: "Blocked", blockedByDevelopment: true, bbdWho: "dev_016", bbdWhy: expect.stringMatching(/kj hu move/) });
    pg.tools.update_card = () => ({ message: "ok" }); // answers, writes nothing
    await expect(manager.move(short_id, "pending")).rejects.toMatchObject({ name: "BoardRejectedError", message: expect.stringMatching(/failed after the move to pending/) });
  });
});
