// HU-0020 (ADR 0021, decisions 5 and 8): resolve matches a task to the best
// artifact for a role and returns its block; atril route prints its paths.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "../src/index.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
let dir;
const write = (path, front, body = "body") => {
  const file = join(dir, ".atril", path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `---\n${front}\ndescription: d\n---\n${body}\n`);
};
const run = (task, role, budget) => resolve({ task, role, budget, projectDir: dir, userRoot: "none" });
const refs = (block) => block.map((a) => `${a.kind}:${a.name}`);
const cli = (...args) => spawnSync(process.execPath, [BIN, "route", ...args], {
  cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_ROOT: "", ATRIL_USER_ROOT: join(dir, "none") },
});

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "atril-route-")));
  write("skills/tdd/SKILL.md", "name: tdd\nkind: skill\nroles: [coder]\nuses: [skill:base]\natril:\n  keywords: [test, failing]");
  write("skills/base/SKILL.md", "name: base\nkind: skill");
  write("skills/audit/SKILL.md", "name: audit\nkind: skill\natril:\n  roles: [security]\n  keywords: [test]");
  write("commands/ship.md", "name: ship\nkind: command\ndelegates: [agent:tester]");
  write("agents/tester.md", "name: tester\nkind: agent\nuses: [skill:base]");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("resolve", () => {
  it("matches a task to a skill by keywords and loads its uses", () => {
    const result = run("write the failing test", "coder");
    expect(refs(result.block)).toEqual(["skill:base", "skill:tdd"]);
    expect(result.block[1].path).toBe(join(dir, ".atril", "skills", "tdd", "SKILL.md"));
    expect(result.left).toEqual([]);
  });

  it("excludes an artifact declared for another role, author's or discovered", () => {
    expect(refs(run("test", "security").block).at(-1)).toBe("skill:audit");
    expect(refs(run("failing test", "tester").block)).toEqual([]);
  });

  it("returns an empty block and says why when nothing matches", () => {
    expect(run("deploy kubernetes", "coder")).toEqual({
      block: [], suggested: [], left: [], reason: 'no artifact matches "deploy kubernetes" for role coder',
    });
  });

  it("applies the budget to the matched block", () => {
    expect(run("failing test", "coder", { maxArtifacts: 1 }).left.map((a) => a.name)).toEqual(["base"]);
  });

  it("fails loudly on an empty task or role", () => {
    expect(() => run("  ", "coder")).toThrow(/non-empty task/);
    expect(() => run("test", "")).toThrow(/role must be a non-empty string/);
  });
});

describe("atril route", () => {
  it("prints the paths to read, subagents marked with their own block", () => {
    const res = cli("ship");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe([
      `subagent\t${join(dir, ".atril", "agents", "tester.md")}`,
      `  inline\t${join(dir, ".atril", "skills", "base", "SKILL.md")}`,
      `inline\t${join(dir, ".atril", "commands", "ship.md")}`, "",
    ].join("\n"));
  });

  it("--json gives the block as paths, without content", () => {
    const out = JSON.parse(cli("failing", "test", "--role", "coder", "--json").stdout);
    expect(out).toEqual({
      block: [
        { name: "base", kind: "skill", path: join(dir, ".atril", "skills", "base", "SKILL.md"), as: "inline" },
        { name: "tdd", kind: "skill", path: join(dir, ".atril", "skills", "tdd", "SKILL.md"), as: "inline" },
      ],
      suggested: [], left: [],
    });
  });

  it("says so when nothing matches and fails without a task", () => {
    expect(cli("kubernetes").stdout).toBe('no artifact matches "kubernetes"\n');
    expect(cli().status).toBe(1);
  });
});
