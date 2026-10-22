// HU-0018 (ADR 0021, decisions 5 and 9): applying one artifact loads its
// block, the closure of uses in dependency order; a delegated agent is one
// subagent item carrying its own block; related artifacts are suggested.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveBlock } from "../src/index.js";

let dir;
const write = (store, path, front, body = `${path} body`) => {
  const file = join(dir, store, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `---\n${front}\ndescription: d\n---\n${body}\n`);
  return file;
};
const resolve = (ref, budget) => resolveBlock(ref, { projectDir: dir, root: "proj", userRoot: "user" }, budget);
const names = (list) => list.map((a) => a.name);

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

  const refs = (block) => block.map((a) => `${a.kind}:${a.name}`);

  it("loads the closure of uses in dependency order, the applied artifact last", () => {
    const { block } = resolve("command:ship");
    expect(refs(block)).toEqual(["skill:style", "agent:tester", "command:ship"]);
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
    expect(refs(resolve("skill:x").block)).toEqual(["skill:a", "skill:b", "skill:x"]);
  });

  it("gives a delegated agent its own block and keeps its dependencies out of the caller's", () => {
    const { block } = resolve("command:ship");
    expect(block.map((a) => a.as)).toEqual(["inline", "subagent", "inline"]);
    const tester = block[1];
    expect(tester.content).toBe("agents/tester.md body\n");
    expect(refs(tester.block)).toEqual(["skill:base", "skill:tdd"]);
    expect(tester.block.every((a) => a.as === "inline" && !("block" in a))).toBe(true);
    expect("block" in block[0]).toBe(false);
  });

  it("puts a skill used by both caller and subagent in both blocks", () => {
    write("proj", "commands/ship.md", "name: ship\nkind: command\nuses: [skill:tdd]\ndelegates: [agent:tester]");
    const { block } = resolve("command:ship");
    expect(refs(block)).toEqual(["skill:base", "skill:tdd", "agent:tester", "command:ship"]);
    expect(refs(block[2].block)).toEqual(["skill:base", "skill:tdd"]);
  });

  it("loads an agent inline too when the caller both uses and reaches it as a delegate", () => {
    write("proj", "commands/ship.md", "name: ship\nkind: command\nuses: [skill:runner, agent:tester]");
    write("proj", "skills/runner/SKILL.md", "name: runner\nkind: skill\ndelegates: [agent:tester]");
    const { block } = resolve("command:ship");
    expect(block.map((a) => `${a.kind}:${a.name}:${a.as}`)).toEqual([
      "agent:tester:subagent", "skill:runner:inline", "skill:base:inline", "skill:tdd:inline", "agent:tester:inline", "command:ship:inline",
    ]);
  });

  it("nests a subagent of a subagent inside its caller's block", () => {
    write("proj", "agents/tester.md", "name: tester\nkind: agent\nuses: [skill:tdd]\ndelegates: [agent:fixer]");
    write("proj", "agents/fixer.md", "name: fixer\nkind: agent\nuses: [skill:style]");
    const { block } = resolve("command:ship");
    expect(refs(block)).toEqual(["skill:style", "agent:tester", "command:ship"]);
    const fixer = block[1].block.at(-1);
    expect(refs(block[1].block)).toEqual(["skill:base", "skill:tdd", "agent:fixer"]);
    expect(fixer.as).toBe("subagent");
    expect(refs(fixer.block)).toEqual(["skill:style"]);
  });

  it("lists related artifacts outside the block only as suggested", () => {
    const { block, suggested } = resolve("command:ship");
    expect(block.some((a) => a.name === "review")).toBe(false);
    expect(suggested).toEqual([{ name: "review", kind: "command", path: join(dir, "proj", "commands", "review.md") }]);
    expect(resolve("skill:base")).toEqual({ block: [expect.objectContaining({ name: "base", as: "inline" })], suggested: [], left: [] });
  });

  it("suggests only from the caller's own context, never from a subagent's", () => {
    write("proj", "agents/tester.md", "name: tester\nkind: agent\nuses: [skill:tdd]\nrelated: [command:audit]");
    write("proj", "commands/audit.md", "name: audit\nkind: command");
    expect(resolve("command:ship").suggested.map((a) => a.name)).toEqual(["review"]);
  });
  it("fails loudly on an unknown ref, naming it", () => {
    expect(() => resolve("skill:nope")).toThrow("skill:nope does not exist");
  });

  // HU-0019 (ADR 0021, decision 9): the budget bounds each context on its own.
  describe("budget", () => {
    const leftOf = (name, owner, store = "proj") => ({ name, kind: "skill", path: join(dir, store, "skills", name, "SKILL.md"), for: owner });

    it("cuts the deepest dependencies of each context first, naming them in left", () => {
      const { block, left } = resolve("command:ship", { maxArtifacts: 2 });
      expect(names(block)).toEqual(["tester", "ship"]);
      expect(names(block[0].block)).toEqual(["tdd"]);
      expect(left).toEqual([leftOf("style", "caller", "user"), leftOf("base", "agent:tester")]);
    });

    it("estimates tokens as ceil(chars / 4) per context", () => {
      // Caller: style 7 + tester 6 + ship 6 = 19. Tester: base 7 + tdd 7 + tester 6 = 20.
      expect(resolve("command:ship", { maxTokens: 20 }).left).toEqual([]);
      expect(resolve("command:ship", { maxTokens: 19 }).left).toEqual([leftOf("base", "agent:tester")]);
    });

    it("cuts a subagent's heavy dependency inside its own block, the caller's unaffected", () => {
      write("proj", "skills/tdd/SKILL.md", "name: tdd\nkind: skill", "x".repeat(400));
      const { block, left } = resolve("command:ship", { maxTokens: 30 });
      expect(names(block)).toEqual(["style", "tester", "ship"]);
      expect(names(block[1].block)).toEqual(["base"]);
      expect(left).toEqual([leftOf("tdd", "agent:tester")]);
    });

    it("cuts by depth, not block order", () => {
      write("proj", "commands/ship.md", "name: ship\nkind: command\nuses: [skill:c, skill:a]");
      write("proj", "skills/a/SKILL.md", "name: a\nkind: skill\nuses: [skill:b]");
      for (const name of ["b", "c"]) write("proj", `skills/${name}/SKILL.md`, `name: ${name}\nkind: skill`);
      const { block, left } = resolve("command:ship", { maxArtifacts: 3 });
      expect(names(block)).toEqual(["c", "a", "ship"]);
      expect(left).toEqual([leftOf("b", "caller")]);
    });

    it("fits each level of nested subagents on its own", () => {
      write("proj", "agents/tester.md", "name: tester\nkind: agent\nuses: [skill:tdd]\ndelegates: [agent:fixer]");
      write("proj", "agents/fixer.md", "name: fixer\nkind: agent\nuses: [skill:style, skill:base]");
      const { block, left } = resolve("command:ship", { maxArtifacts: 2 });
      expect(names(block)).toEqual(["tester", "ship"]);
      expect(names(block[0].block)).toEqual(["fixer"]);
      expect(names(block[0].block[0].block)).toEqual(["base"]);
      expect(left).toEqual([
        leftOf("style", "caller", "user"), leftOf("base", "agent:tester"), leftOf("tdd", "agent:tester"),
        leftOf("style", "agent:fixer", "user"),
      ]);
    });

    it("keeps or cuts a dependency shared by caller and subagent separately in each context", () => {
      write("proj", "commands/ship.md", "name: ship\nkind: command\nuses: [skill:tdd]\ndelegates: [agent:tester]");
      const { block, left } = resolve("command:ship", { maxArtifacts: 3 });
      expect(names(block)).toEqual(["tdd", "tester", "ship"]);
      expect(names(block[1].block)).toEqual(["base", "tdd"]);
      expect(left).toEqual([leftOf("base", "caller")]);
    });

    it("fails naming the applied artifact when it alone exceeds the budget", () => {
      expect(() => resolve("command:ship", { maxTokens: 5 })).toThrow("command:ship alone exceeds the budget");
    });

    it("keeps every block whole and an empty left within budget", () => {
      const { block, left } = resolve("command:ship", { maxArtifacts: 3, maxTokens: 1000 });
      expect(names(block)).toEqual(["style", "tester", "ship"]);
      expect(names(block[1].block)).toEqual(["base", "tdd"]);
      expect(left).toEqual([]);
    });

    it("rejects a budget limit that is not a positive integer", () => {
      expect(() => resolve("command:ship", { maxArtifacts: 0 })).toThrow("maxArtifacts must be a positive integer");
      expect(() => resolve("command:ship", { maxTokens: "9" })).toThrow("maxTokens must be a positive integer");
    });

    it("rejects a budget that is not an object or has an unknown limit", () => {
      expect(() => resolve("command:ship", null)).toThrow("budget must be an object");
      expect(() => resolve("command:ship", { maxToken: 10 })).toThrow("unknown budget limit maxToken");
    });
  });
});
