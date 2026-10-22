// HU-0018 (ADR 0021, decisions 5 and 9): applying one artifact loads its
// block, the closure of uses and delegates in dependency order; related
// artifacts are only suggested.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveBlock } from "../src/index.js";

let dir;
const write = (store, path, front) => {
  const file = join(dir, store, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `---\n${front}\ndescription: d\n---\n${path} body\n`);
  return file;
};
const resolve = (ref) => resolveBlock(ref, { projectDir: dir, root: "proj", userRoot: "user" });

describe("resolveBlock", () => {
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "atril-resolve-")));
    write("proj", "commands/ship.md", "name: ship\nkind: command\nuses: [skill:style]\ndelegates: [agent:tester]\nrelated: [command:review]");
    write("proj", "agents/tester.md", "name: tester\nkind: agent\nuses: [skill:tdd]\natril:\n  uses: [skill:base, skill:tdd]");
    write("proj", "skills/tdd/SKILL.md", "name: tdd\nkind: skill\nuses: [skill:base]\nrelated: [command:ship]");
    write("proj", "skills/base/SKILL.md", "name: base\nkind: skill");
    write("proj", "commands/review.md", "name: review\nkind: command");
    write("user", "skills/style/SKILL.md", "name: style\nkind: skill");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("loads the closure of uses and delegates, each piece after what it depends on", () => {
    const { block } = resolve("command:ship");
    expect(block.map((a) => `${a.kind}:${a.name}`)).toEqual(["skill:style", "skill:base", "skill:tdd", "agent:tester", "command:ship"]);
    expect(block[0]).toEqual({
      name: "style", kind: "skill", source: "user", path: join(dir, "user", "skills", "style", "SKILL.md"),
      content: "skills/style/SKILL.md body\n", as: "inline",
    });
    expect(block[2].source).toBe("project");
  });

  it("loads the author's relations before the discovered ones when independent", () => {
    write("proj", "skills/x/SKILL.md", "name: x\nkind: skill\nuses: [skill:a]\natril:\n  uses: [skill:b]");
    write("proj", "skills/a/SKILL.md", "name: a\nkind: skill");
    write("proj", "skills/b/SKILL.md", "name: b\nkind: skill");
    expect(resolve("skill:x").block.map((a) => `${a.kind}:${a.name}`)).toEqual(["skill:a", "skill:b", "skill:x"]);
  });

  it("marks the delegated agent as a subagent and the rest as inline", () => {
    expect(resolve("command:ship").block.map((a) => a.as)).toEqual(["inline", "inline", "inline", "subagent", "inline"]);
  });

  it("lists related artifacts outside the block only as suggested", () => {
    const { block, suggested } = resolve("command:ship");
    expect(block.some((a) => a.name === "review")).toBe(false);
    expect(suggested).toEqual([{ name: "review", kind: "command", path: join(dir, "proj", "commands", "review.md") }]);
    expect(resolve("skill:base")).toEqual({ block: [expect.objectContaining({ name: "base", as: "inline" })], suggested: [] });
  });

  it("fails loudly on an unknown ref, naming it", () => {
    expect(() => resolve("skill:nope")).toThrow("skill:nope does not exist");
  });
});
