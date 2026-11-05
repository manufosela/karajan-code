// HU-3390 (epic #3332): a community task manager loads only when board.yml lists it, at an exact version.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadManager } from "../../src/hu/managers/index.js";
import { parseAllow } from "../../src/hu/managers/allowlist.js";
import { readBoardConfig } from "../../src/hu/board-config.js";
import { createTaskManagerCheck } from "../../src/checks/task-manager.js";

const GOOD = `export const credentials = ["ACME_TOKEN"];
export const createManager = ({ env }) => ({ seenEnv: env, create() {}, list() {}, move() {}, claim() {},
  capabilities: { acceptanceCriteria: "field", dependencies: "graph", assignee: true, verdicts: "comment", offline: true } });`;
const entry = { name: "kj-board-acme", version: "1.0.0" };
const board = (allow = [entry]) => ({ backend: "acme", managers: { allow }, acme: { workspace: "w" } });

/** A project dir; the fixture's index.js writes a marker file when it is imported (null source: not installed). */
function project({ version = "1.0.0", source = GOOD } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-community-"));
  const marker = path.join(dir, "imported.marker");
  if (source !== null) {
    const pkg = path.join(dir, "node_modules", entry.name);
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: entry.name, version, type: "module", main: "index.js" }));
    fs.writeFileSync(path.join(pkg, "index.js"), `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(marker)}, "x");\n${source}`);
  }
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  return { dir, marker };
}

describe("community managers: loadManager", () => {
  it("loads the listed, installed, exact-version package with only its declared credentials", async () => {
    const { dir } = project();
    const manager = await loadManager(board(), { projectDir: dir, env: { ACME_TOKEN: "t", OTHER_SECRET: "s" } });
    expect(manager.seenEnv).toEqual({ ACME_TOKEN: "t" });
    expect(manager.credentials).toEqual(["ACME_TOKEN"]);
    expect(manager.source).toEqual(entry);
  });

  it("gives a manager that declares no credentials an empty env", async () => {
    const { dir } = project({ source: GOOD.replace('["ACME_TOKEN"]', "[]") });
    expect((await loadManager(board(), { projectDir: dir, env: { ACME_TOKEN: "t" } })).seenEnv).toEqual({});
  });

  it("refuses an installed package that is not listed, and never runs its code", async () => {
    const { dir, marker } = project();
    for (const allow of [[], [{ name: "kj-board-other", version: "1.0.0" }]]) {
      await expect(loadManager(board(allow), { projectDir: dir })).rejects.toThrow(/not in managers\.allow/);
    }
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("refuses a wrong version without running the code, and a missing package with the fix", async () => {
    const wrong = project({ version: "1.0.1" });
    await expect(loadManager(board(), { projectDir: wrong.dir })).rejects.toThrow(/1\.0\.1.*1\.0\.0/);
    expect(fs.existsSync(wrong.marker)).toBe(false);
    await expect(loadManager(board(), { projectDir: project({ source: null }).dir })).rejects.toThrow(/install it yourself, kj never installs/);
  });

  it("refuses a manager that fails the contract, and a module with no createManager", async () => {
    await expect(loadManager(board(), { projectDir: project({ source: "export const createManager = () => ({});" }).dir })).rejects.toThrow(/task manager is missing/);
    await expect(loadManager(board(), { projectDir: project({ source: "export const x = 1;" }).dir })).rejects.toThrow(/does not export createManager/);
  });

  it("keeps the built-in names first: a community entry cannot shadow one", async () => {
    expect(() => parseAllow({ allow: [{ name: "@acme/board-github", version: "1.0.0" }] })).toThrow(/shadow the built-in "github"/);
    const manager = await loadManager({ backend: "github", repo: "acme/app", managers: { allow: [entry] } }, { env: {}, run: async () => ({ exitCode: 0, stdout: "[]" }) });
    expect(manager.source).toBeUndefined();
  });
});

describe("managers.allow format", () => {
  it.each([["../x", "1.0.0"], ["/abs", "1.0.0"], ["a b", "1.0.0"], ["A", "1.0.0"], [`a${"b".repeat(214)}`, "1.0.0"], ["kj-board-x", "^1.0.0"], ["kj-board-x", "latest"], ["kj-board-x", "1.0"]])("rejects %s@%s", (name, version) => {
    expect(() => parseAllow({ allow: [{ name, version }] })).toThrow(/npm package name|exact version/);
  });

  it("rejects duplicates and two packages for one backend, accepts scoped names", () => {
    expect(() => parseAllow({ allow: [entry, entry] })).toThrow(/both map to the backend "acme"/);
    expect(() => parseAllow({ allow: [entry, { name: "@x/board-acme", version: "2.0.0" }] })).toThrow(/both map/);
    expect(parseAllow({ allow: [{ name: "@x/kj-board-acme", version: "2.0.0-rc.1" }] })).toEqual([{ name: "@x/kj-board-acme", version: "2.0.0-rc.1", backend: "acme" }]);
  });

  it("is read from board.yml: a community backend needs its allow entry", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-board-"));
    fs.mkdirSync(path.join(dir, ".karajan"));
    const write = (text) => fs.writeFileSync(path.join(dir, ".karajan", "board.yml"), text);
    write("backend: acme\nacme:\n  workspace: w\nmanagers:\n  allow:\n    - { name: kj-board-acme, version: 1.0.0 }\n");
    expect(await readBoardConfig(dir)).toEqual(board());
    write("backend: acme\n");
    await expect(readBoardConfig(dir)).rejects.toThrow(/github, linear, local/);
  });
});

describe("kj doctor: community manager", () => {
  const detect = (dir, allow, env = {}) => createTaskManagerCheck({ projectDir: dir, boardConfig: async () => board(allow), env }).detect();

  it("shows the allowlist, the version, the capabilities and the missing credential", async () => {
    const r = await detect(project().dir, undefined, {});
    expect(r).toMatchObject({ ok: false, severity: "warn", fix: expect.stringMatching(/ACME_TOKEN/) });
    expect(r.detail).toMatch(/acme: kj-board-acme@1\.0\.0 \(allow: kj-board-acme@1\.0\.0\) — can: /);
    expect(r.detail).toMatch(/ACME_TOKEN is not set/);
  });

  it("shows the reason and the fix for a refusal", async () => {
    const r = await detect(project({ source: null }).dir);
    expect(r).toMatchObject({ ok: false, detail: expect.stringMatching(/not installed/), fix: expect.stringMatching(/npm install --save-exact kj-board-acme@1\.0\.0/) });
    expect((await detect(project().dir, [])).fix).toMatch(/managers\.allow/);
  });
});
