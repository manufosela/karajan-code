// KJC-TSK-1372 (#2853, step 7 of #2566): `kj hu start <id> [slug]` checks the card, opens its
// lane feat/<id>-<slug> and moves it to running, in the order that works.
import { describe, expect, it } from "vitest";
import { slugOf, startAction } from "../../src/commands/hu-start.js";

const card = (over = {}) => ({ id: "HU-42", title: "Board ▶ opens a lane", status: "pending", claimed_by: null, ...over });

function harness({ found = card(), who = "manufosela" } = {}) {
  const calls = [];
  const deps = {
    findCard: async (ref) => { calls.push(`find ${ref}`); return found; },
    worktree: async ({ args }) => { calls.push(`lane ${args[0]}`); return { path: `/repo/.kj/worktrees/${args[0]}`, branch: `feat/${args[0]}` }; },
  };
  const move = async () => { calls.push("move running"); };
  const run = (args) => startAction({ config: {}, args, deps, move, who, emit: (obj) => obj });
  return { calls, run };
}

describe("kj hu start — KJC-TSK-1372", () => {
  it("opens the lane <id>-<slug> from the card, then moves the card to running", async () => {
    const { calls, run } = harness();
    const r = await run(["HU-42", "board-play"]);
    expect(calls).toEqual(["find HU-42", "lane HU-42-board-play", "move running"]);
    expect(r).toMatchObject({ id: "HU-42", branch: "feat/HU-42-board-play", lane: "/repo/.kj/worktrees/HU-42-board-play" });
  });

  it("without a slug it derives one from the card's title", async () => {
    const { calls, run } = harness();
    await run(["HU-42"]);
    expect(calls).toContain("lane HU-42-board-opens-a-lane");
    expect(slugOf("Añadir búsqueda: ¡rápida! y más")).toBe("anadir-busqueda-rapida-y-mas");
    expect(slugOf("¿?")).toBe("task");
  });

  it("fails before creating anything when the card does not exist or someone else holds it", async () => {
    const missing = harness({ found: null });
    await expect(missing.run(["HU-9"])).rejects.toThrow(/HU-9 not found/);
    expect(missing.calls).toEqual(["find HU-9"]);
    const held = harness({ found: card({ status: "running", claimed_by: "jorgecasar" }) });
    await expect(held.run(["HU-42"])).rejects.toThrow(/held by jorgecasar/);
    expect(held.calls).toEqual(["find HU-42"]);
  });

  // KJC-TSK-1324: the board's ▶ starts the card and has the panel coder write in its lane.
  it("with --code the panel coder runs in the lane on the card, after the card is running", async () => {
    const calls = [];
    const deps = { findCard: async () => card(), worktree: async () => ({ path: "/lanes/HU-42-x", branch: "feat/HU-42-x" }), runCoder: (o) => { calls.push(o); return 0; } };
    await startAction({ config: {}, args: ["HU-42", "x"], flags: { code: true }, deps, move: async () => calls.push("moved"), who: "me", emit: (o) => o });
    expect(calls).toEqual(["moved", { cwd: "/lanes/HU-42-x", card: "HU-42", task: "Board ▶ opens a lane" }]);
    const failing = { ...deps, runCoder: () => 3 };
    await expect(startAction({ config: {}, args: ["HU-42", "x"], flags: { code: true }, deps: failing, move: async () => {}, who: "me", emit: (o) => o }))
      .rejects.toThrow(/coder.*exit 3.*\/lanes\/HU-42-x/);
  });

  it("a card I already hold starts again; a failed move says the lane is there and how to finish", async () => {
    const mine = harness({ found: card({ status: "running", claimed_by: "manufosela" }) });
    await expect(mine.run(["HU-42", "x"])).resolves.toMatchObject({ id: "HU-42" });
    const { run } = harness();
    const failing = (args) => startAction({ config: {}, args, deps: { findCard: async () => card(), worktree: async () => ({ path: "/l", branch: "feat/HU-42-x" }) }, move: async () => { throw new Error("offline"); }, who: "manufosela", emit: (o) => o });
    await expect(failing(["HU-42", "x"])).rejects.toThrow(/lane feat\/HU-42-x is ready.*kj hu move HU-42 running/);
    await expect(run([])).rejects.toThrow(/usage: kj hu start/);
  });
});
