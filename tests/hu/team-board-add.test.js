// KJC-TSK-1163 (TEAM-GH-B, ADR 0025): with the shared board on, kj hu add creates the HU as an
// issue, so its id comes from GitHub and two people never mint the same one.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand } from "../../src/commands/hu.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-team-add-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

const team = (existing = []) => {
  const created = [];
  return {
    created,
    deps: {
      boardConfig: async () => ({ backend: "github", repo: "acme/app" }),
      listTeamHus: async () => existing,
      createTeamHu: async (args) => { created.push(args); return { short_id: "HU-42", number: 42, status: "pending", title: args.title }; },
    },
  };
};
const add = (title, flags, deps) => huCommand({ config: { projectDir: dir }, action: "add", args: [title], flags: { json: true, ...flags }, deps });

describe("kj hu add on the shared board", () => {
  it("creates the issue with its criteria, tests and ref, and never touches the local plan", async () => {
    const { created, deps } = team();
    const r = await add("Login with SSO", { ac: ["redirects"], tests: ["e2e login"], ref: "KJC-TSK-9" }, deps);
    expect(r).toMatchObject({ short_id: "HU-42", status: "pending", board: "github" });
    expect(created[0]).toMatchObject({ repo: "acme/app", title: "Login with SSO", acceptanceCriteria: ["redirects"], tests: ["e2e login"], ref: "KJC-TSK-9" });
    expect(fs.existsSync(path.join(dir, ".karajan", "plans"))).toBe(false);
  });

  it("refuses a title the team board already has, and an id GitHub did not give", async () => {
    const { created, deps } = team([{ short_id: "HU-7", title: "Login with SSO", status: "running" }]);
    await expect(add("login with sso", {}, deps)).rejects.toThrow(/already exists: HU-7/);
    await expect(add("Other work", { id: "HU-0001" }, team().deps)).rejects.toThrow(/--id.*GitHub/);
    expect(created).toHaveLength(0);
  });
});

// KJC-TSK-1164 (TEAM-GH-C): list and move on the same board, so a HU created there can be worked.
describe("kj hu list and move on the shared board", () => {
  const hu = (action, args, flags, deps) => huCommand({ config: { projectDir: dir }, action, args, flags: { json: true, ...flags }, deps });

  it("lists the issues with who holds each", async () => {
    const { deps } = team([{ short_id: "HU-7", number: 7, title: "A", status: "running", claimed_by: "jorgecasar" }]);
    expect(await hu("list", [], {}, deps)).toEqual([expect.objectContaining({ id: "HU-7", status: "running", claimed_by: "jorgecasar", plan: "github" })]);
  });

  it("starting a HU claims it before moving it, and a HU held by someone else stops there", async () => {
    const calls = [];
    const deps = { ...team().deps, who: "manufosela", claimTeamHu: async (a) => { calls.push(["claim", a]); }, setTeamStatus: async (a) => { calls.push(["status", a]); } };
    expect(await hu("move", ["HU-7", "running"], {}, deps)).toEqual({ id: "HU-7", status: "running", claimed_by: "manufosela" });
    expect(calls.map((c) => c[0])).toEqual(["claim", "status"]);
    expect(calls[0][1]).toMatchObject({ repo: "acme/app", number: 7, who: "manufosela", release: false });
    const held = { ...deps, claimTeamHu: async () => { throw new Error("HU-7 is held by jorgecasar"); } };
    calls.length = 0;
    await expect(hu("move", ["HU-7", "running"], {}, held)).rejects.toThrow(/held by jorgecasar/);
    expect(calls).toHaveLength(0);
  });

  it("moving someone else's running HU to any status needs --release, which claims it first", async () => {
    const calls = [];
    const deps = {
      ...team().deps, who: "manufosela",
      assertNotHeld: async () => { throw new Error("HU-7 is held by jorgecasar"); },
      claimTeamHu: async (a) => { calls.push(["claim", a.release]); },
      setTeamStatus: async () => { calls.push(["status"]); },
    };
    await expect(hu("move", ["HU-7", "done"], {}, deps)).rejects.toThrow(/held by jorgecasar/);
    expect(calls).toHaveLength(0);
    await hu("move", ["HU-7", "done"], { release: true }, deps);
    expect(calls).toEqual([["claim", true], ["status"]]);
  });

  it("refuses a local id and a clone with no GitHub login", async () => {
    const deps = { ...team().deps, who: "manufosela", setTeamStatus: async () => {}, assertNotHeld: async () => {} };
    await expect(hu("move", ["HU-0090", "done"], {}, { ...deps })).resolves.toMatchObject({ id: "HU-90" });
    await expect(hu("move", ["T-1", "done"], {}, deps)).rejects.toThrow(/HU-<issue number>/);
    await expect(hu("move", ["HU-7", "running"], {}, { ...deps, who: "a@b.c" })).rejects.toThrow(/GitHub login/);
  });
});
