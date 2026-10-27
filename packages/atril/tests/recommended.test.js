// ADR 0021, decision 13 and plan step 12a: atril ships a recommended set in its package, a
// catalog like any other and the one it offers first; `atril recommended` shows each entry
// installed (and how), changed against this version's set, or available.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECOMMENDED, availableArtifacts, catalogs, recommendedDir } from "../src/catalog.js";
import { readConfig, writeConfig } from "../src/config.js";
import { applyRecommended, recommended } from "../src/recommended.js";
import { scanStore } from "../src/scan.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-recommended-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const command = (rel, name, body = "body") => put(rel, `---\nname: ${name}\ndescription: ${name} things\nkind: command\n---\n${body}\n`);
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store"), recommended: join(dir, "set") });

describe("the bundled set", () => {
  it("ships in the package and is the first catalog, before the project's", () => {
    expect(PKG.files).toContain("recommended/");
    mkdirSync(join(dir, "set"));
    expect(RECOMMENDED).toBe(fileURLToPath(new URL("../recommended", import.meta.url)));
    command("kit/commands/deploy.md", "deploy");
    writeConfig({ catalogs: ["kit"] }, o());
    expect(catalogs(o()).map(({ ref, dir: at }) => [ref, at])).toEqual([
      ["atril:recommended", join(dir, "set")],
      ["kit", join(dir, "kit")],
    ]);
  });

  it("is the bundled folder unless one is named, and parses", () => {
    expect(recommendedDir({ env: {} })).toBe(RECOMMENDED);
    expect(() => scanStore(RECOMMENDED)).not.toThrow();
  });

  it("a named set resolves against the project and must exist", () => {
    mkdirSync(join(dir, "set"));
    expect(recommendedDir({ projectDir: dir, env: { ATRIL_RECOMMENDED: "set" } })).toBe(join(dir, "set"));
    expect(() => recommendedDir({ projectDir: dir, recommended: "gone" })).toThrow(/recommended set .*gone not found/);
  });

  it("wins a name it shares with a project catalog", () => {
    command("set/commands/deploy.md", "deploy");
    command("kit/commands/deploy.md", "deploy");
    writeConfig({ catalogs: ["kit"] }, o());
    expect(availableArtifacts(o()).map(({ name, catalog }) => [name, catalog])).toEqual([["deploy", "atril:recommended"]]);
  });
});

describe("recommended", () => {
  beforeEach(() => {
    for (const name of ["plan", "review", "ship", "test"]) command(`set/commands/${name}.md`, name);
    command("store/commands/review.md", "review");
    command("store/commands/ship.md", "ship");
    command("store/commands/test.md", "test", "edited by the user");
    put("set/skills/lint/SKILL.md", "---\nname: lint\ndescription: lint code\nkind: skill\n---\nlint\n");
    // atril's enrichment block is not an edit.
    put("store/skills/lint/SKILL.md", "---\nname: lint\ndescription: lint code\nkind: skill\natril:\n  keywords: [lint]\n---\nlint\n");
    writeConfig({ expose: { command: ["ship"] } }, o());
  });

  it("reports each entry available, on demand, persistent or changed", () => {
    expect(recommended(o()).map(({ kind, name, state }) => `${state} ${kind}:${name}`)).toEqual([
      "on-demand skill:lint",
      "available command:plan",
      "on-demand command:review",
      "persistent command:ship",
      "changed command:test",
    ]);
  });

  it("atril recommended prints the same, as text or JSON", () => {
    const run = (...args) => spawnSync(process.execPath, [BIN, "recommended", "--root", "store", ...args], {
      cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_USER_ROOT: join(dir, "no-user-store"), ATRIL_RECOMMENDED: join(dir, "set") },
    });
    const text = run();
    expect(text.status).toBe(0);
    expect(text.stdout.split("\n")[1]).toBe("available\tcommand:plan\tplan things");
    const json = JSON.parse(run("--json").stdout);
    expect(json.map(({ state }) => state)).toEqual(["on-demand", "available", "on-demand", "persistent", "changed"]);
  });
});

// Plan step 12b: answers already decided are applied without asking.
describe("applyRecommended", () => {
  beforeEach(() => {
    for (const name of ["plan", "review", "ship", "test"]) command(`set/commands/${name}.md`, name);
    command("store/commands/review.md", "review");
    command("store/commands/test.md", "test", "edited by the user");
    put("set/skills/lint/SKILL.md", "---\nname: lint\ndescription: lint code\nkind: skill\n---\nlint\n");
  });
  const read = (rel) => readFileSync(join(dir, rel), "utf8");

  it("installs on-demand answers, also exposes persistent ones, and skips the rest", () => {
    const result = applyRecommended({ "command:plan": "on-demand", "command:review": "persistent", "command:ship": "persistent", "skill:lint": "skip" }, o());
    expect(result).toEqual({ installed: ["command:plan", "command:review", "command:ship"], exposed: ["command:review", "command:ship"], skipped: ["skill:lint"], changed: [] });
    expect(read("store/commands/plan.md")).toBe(read("set/commands/plan.md"));
    expect(recommended(o()).map(({ name, state }) => `${state} ${name}`)).toEqual([
      "available lint", "on-demand plan", "persistent review", "persistent ship", "changed test",
    ]);
  });

  it("installs a skill folder from the set", () => {
    expect(applyRecommended({ "skill:lint": "on-demand" }, o()).installed).toEqual(["skill:lint"]);
    expect(read("store/skills/lint/SKILL.md")).toBe(read("set/skills/lint/SKILL.md"));
  });

  it("an on-demand answer takes a persistent entry out of expose", () => {
    applyRecommended({ "command:review": "persistent" }, o());
    expect(applyRecommended({ "command:review": "on-demand" }, o()).exposed).toEqual([]);
    expect(recommended(o()).find(({ name }) => name === "review").state).toBe("on-demand");
  });

  it("applies the same answers twice without reinstalling", () => {
    const answers = { "command:plan": "persistent" };
    applyRecommended(answers, o());
    expect(applyRecommended(answers, o())).toEqual({ installed: ["command:plan"], exposed: ["command:plan"], skipped: [], changed: [] });
  });

  it("leaves a changed artifact as the user edited it and reports it", () => {
    expect(applyRecommended({ "command:test": "persistent" }, o())).toEqual({ installed: [], exposed: [], skipped: [], changed: ["command:test"] });
    expect(read("store/commands/test.md")).toContain("edited by the user");
    expect(recommended(o()).find(({ name }) => name === "test").state).toBe("changed");
  });

  it("leaves the exposure of a changed artifact as it was", () => {
    writeConfig({ expose: { command: ["test"] } }, o());
    expect(applyRecommended({ "command:test": "on-demand" }, o()).changed).toEqual(["command:test"]);
    expect(readConfig(o()).expose.command).toEqual(["test"]);
    expect(read("store/commands/test.md")).toContain("edited by the user");
  });

  it.each([
    [{ "command:plan": "on-demand", "command:gone": "skip" }, /command:gone is not in the recommended set/],
    [{ "command:review": "persistent", "skill:lint": "always" }, /skill:lint: "always" is not one of skip, on-demand, persistent/],
    [null, /answers must be an object of kind:name/],
  ])("validates every answer before applying any", (answers, message) => {
    expect(() => applyRecommended(answers, o())).toThrow(message);
    expect(recommended(o()).map(({ state }) => state)).toEqual(["available", "available", "on-demand", "available", "changed"]);
  });
});
