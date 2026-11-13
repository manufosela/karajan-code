// KJC-TSK-1372 (#2853, step 7 of #2566): `kj hu start <id> [slug]` checks the card, opens its
// lane feat/<id>-<slug> and moves it to running, in the order that works.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ACTIVITY_FILE } from "../../src/agents/activity.js";
import { slugOf, startAction } from "../../src/commands/hu-start.js";

const card = (over = {}) => ({ id: "HU-42", title: "Board ▶ opens a lane", status: "pending", claimed_by: null, ...over });

const laneOf = (branch) => ({ slug: branch.replace("feat/", ""), branch, path: `/repo/.kj/worktrees/${branch.replace("feat/", "")}` });

function harness({ found = card(), who = "manufosela", lanes = [] } = {}) {
  const calls = [];
  const deps = {
    lanes: async () => lanes,
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
    const deps = { lanes: async () => [], findCard: async () => card(), worktree: async () => ({ path: "/lanes/HU-42-x", branch: "feat/HU-42-x" }), runCoder: (o) => { calls.push(o); return 0; } };
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
    const failing = (args) => startAction({ config: {}, args, deps: { lanes: async () => [], findCard: async () => card(), worktree: async () => ({ path: "/l", branch: "feat/HU-42-x" }) }, move: async () => { throw new Error("offline"); }, who: "manufosela", emit: (o) => o });
    await expect(failing(["HU-42", "x"])).rejects.toThrow(/lane feat\/HU-42-x is ready.*kj hu move HU-42 running/);
    await expect(run([])).rejects.toThrow(/usage: kj hu start/);
  });

  // KJC-BUG-0517: a card that already has a lane does not get a second one.
  it("reuses the lane whose branch names the card id or its external_ref, without opening another", async () => {
    const byId = harness({ lanes: [laneOf("feat/HU-42-old")] });
    expect(await byId.run(["HU-42"])).toMatchObject({ reused: true, branch: "feat/HU-42-old", lane: "/repo/.kj/worktrees/HU-42-old" });
    expect(byId.calls).toEqual(["find HU-42", "move running"]);
    const byRef = harness({ found: card({ external_ref: "gh#1 · KJC-BUG-0517" }), lanes: [laneOf("feat/KJC-BUG-0517-x")] });
    expect(await byRef.run(["HU-42"])).toMatchObject({ reused: true, branch: "feat/KJC-BUG-0517-x" });
    expect(byRef.calls).not.toContainEqual(expect.stringMatching(/^lane /));
  });

  it("does not take the lane of HU-427 for HU-42", async () => {
    const { calls, run } = harness({ lanes: [laneOf("feat/HU-427-other")] });
    expect(await run(["HU-42", "x"])).not.toHaveProperty("reused");
    expect(calls).toContain("lane HU-42-x");
  });

  it("two lanes of one card: fails naming both, before moving or creating anything", async () => {
    const { calls, run } = harness({ lanes: [laneOf("feat/HU-42-a"), laneOf("feat/HU-42-b")] });
    await expect(run(["HU-42"])).rejects.toThrow(/HU-42-a.*HU-42-b.*kj worktree done/s);
    expect(calls).toEqual(["find HU-42"]);
  });

  it("with --code on a reused lane the coder runs in that lane", async () => {
    const runs = [];
    const deps = { lanes: async () => [laneOf("feat/HU-42-old")], findCard: async () => card(), runCoder: (o) => { runs.push(o.cwd); return 0; } };
    await startAction({ config: {}, args: ["HU-42"], flags: { code: true }, deps, move: async () => {}, who: "me", emit: (o) => o });
    expect(runs).toEqual(["/repo/.kj/worktrees/HU-42-old"]);
  });
});

// HU-4222: the host gets the atril skills of its card and kj stage hears of them.
describe("kj hu start gives the host its skills — HU-4222", () => {
  const two = async () => ({ skills: [{ name: "a-skill" }, { name: "b-skill" }], dropped: [], limit: 3 });
  const start = async (extra) => {
    const lane = fs.mkdtempSync(path.join(os.tmpdir(), "kj-hu-host-"));
    const deps = { lanes: async () => [], findCard: async () => card(), worktree: async () => ({ path: lane, branch: "feat/HU-42-x" }), detectHost: () => "claude", ...extra };
    const out = [];
    const r = await startAction({ config: {}, args: ["HU-42"], deps, move: async () => {}, who: "m", emit: (o, text) => { out.push(text); return o; } });
    const file = path.join(lane, ACTIVITY_FILE);
    const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
    fs.rmSync(lane, { recursive: true, force: true });
    return { r, text: out[0], lines };
  };

  it("names the skills after the cd, in the JSON and on one host start line", async () => {
    const { r, text, lines } = await start({ hostSkills: two });
    expect(text).toMatch(/cd \S+\n## Domain Skills[\s\S]*a-skill, b-skill/);
    expect(r.skills).toEqual(["a-skill", "b-skill"]);
    expect(lines).toEqual([expect.objectContaining({ agent: "claude", role: "host", phase: "start", skills: ["a-skill", "b-skill"] })]);
  });

  it("with none, output and JSON are as before and nothing is noted", async () => {
    const { r, text, lines } = await start({ hostSkills: async () => ({ skills: [], dropped: [] }) });
    expect(r).not.toHaveProperty("skills");
    expect(text).toMatch(/cd \S+$/);
    expect(lines).toEqual([]);
  });

  it("no host detected: nothing is resolved", async () => {
    const hostSkills = vi.fn(two);
    const { lines } = await start({ hostSkills, detectHost: () => null });
    expect(hostSkills).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it("a resolver that throws leaves the start standing, with one warning line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { r } = await start({ hostSkills: async () => { throw new Error("store broken"); } });
    expect(r).toMatchObject({ id: "HU-42" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/store broken/);
    warn.mockRestore();
  });
});
