// Plan step 12d: atril's own recommended set holds `skill:using-atril`, the skill that teaches
// an agent to use atril. These tests run against the real bundled folder, not an override.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECOMMENDED } from "../src/catalog.js";
import { recommended } from "../src/recommended.js";
import { search } from "../src/search.js";

const SKILL = readFileSync(join(RECOMMENDED, "skills/using-atril/SKILL.md"), "utf8");
const CLI = readFileSync(fileURLToPath(new URL("../bin/atril.js", import.meta.url)), "utf8");
const USAGE_LINE = CLI.match(/const USAGE = [\s\S]*?;\n/)[0];
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-content-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store"), env: {} });

describe("skill:using-atril", () => {
  it("is offered as available in an empty project", () => {
    expect(recommended(o())).toEqual([
      expect.objectContaining({ kind: "skill", name: "using-atril", state: "available" }),
    ]);
  });

  it("names only commands the CLI has", () => {
    const verbs = new Set([...SKILL.matchAll(/`atril ([a-z]+)/g)].map(([, verb]) => verb));
    expect([...verbs]).toEqual(expect.arrayContaining(["route", "search", "install", "expose", "mcp"]));
    for (const verb of verbs) expect(CLI).toContain(`command === "${verb}"`);
    for (const flag of SKILL.match(/--[a-z]+/g)) expect(USAGE_LINE).toContain(flag);
  });

  it("ranks first for a search about which skill to use", () => {
    const [first] = search("which skill should I use", o());
    expect(first).toMatchObject({ kind: "skill", name: "using-atril" });
  });
});
