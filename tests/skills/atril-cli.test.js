// KJC-TSK-1193 (ADR 0021, step 15e): kj skills hands atril's commands to atril's own
// CLI, on the project's .karajan store unless the user names another root.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ATRIL_COMMANDS, atrilArgs, atrilBin, atrilSearch, runAtril } from "../../src/skills/atril-cli.js";
import { skillsCommand } from "../../src/commands/skills.js";

describe("atrilArgs", () => {
  it("adds the .karajan store when the user names no root", () => {
    expect(atrilArgs("search", ["front", "--json"])).toEqual(["search", "front", "--json", "--root", ".karajan"]);
  });

  it("leaves the user's root alone, in both spellings", () => {
    expect(atrilArgs("scan", ["--root", "other"])).toEqual(["scan", "--root", "other"]);
    expect(atrilArgs("scan", ["--root=other"])).toEqual(["scan", "--root=other"]);
  });
});

describe("atrilBin", () => {
  it("is the bin next to the atril package kj depends on", () => {
    expect(atrilBin((spec) => `file:///deps/${spec}/src/index.js`)).toBe("/deps/@karajan-family/atril/bin/atril.js");
  });

  it("fails loudly, saying how to install atril, when the package cannot be resolved", () => {
    expect(() => atrilBin(() => { throw new Error("not found"); })).toThrow(/npm i -g @karajan-family\/atril/);
  });
});

describe("runAtril", () => {
  it("runs atril with node and returns atril's own exit code", () => {
    const calls = [];
    const spawn = (cmd, args) => { calls.push([cmd, args]); return { status: 3 }; };
    expect(runAtril({ action: "route", args: ["login form"], spawn, bin: "/b/atril.js" })).toBe(3);
    expect(calls).toEqual([[process.execPath, ["/b/atril.js", "route", "login form", "--root", ".karajan"]]]);
  });

  it("a spawn that cannot start is an error, not a silent pass", () => {
    const spawn = () => ({ error: new Error("ENOENT") });
    expect(() => runAtril({ action: "scan", args: [], spawn, bin: "/b/atril.js" })).toThrow("ENOENT");
  });
});

describe("atrilSearch", () => {
  const bin = "/b/atril.js";

  it("spawns atril's CLI with --json and the query after --", async () => {
    const calls = [];
    const exec = async (...call) => { calls.push(call); return { stdout: '{"mode":"lexical","hits":[]}' }; };
    expect(await atrilSearch("-x y", { kind: "skill", root: "r" }, { exec, bin })).toEqual({ mode: "lexical", hits: [] });
    expect(calls).toEqual([[process.execPath, [bin, "search", "--kind", "skill", "--root", "r", "--json", "--", "-x y"]]]);
  });

  it("searches the .karajan store when no root is named", async () => {
    const calls = [];
    const exec = async (...call) => { calls.push(call); return { stdout: "{}" }; };
    await atrilSearch("q", {}, { exec, bin });
    expect(calls[0][1]).toEqual([bin, "search", "--root", ".karajan", "--json", "--", "q"]);
  });

  it("a non-zero exit carries atril's stderr", async () => {
    const exec = async () => { throw Object.assign(new Error("exit 1"), { stderr: "atril: empty query\n" }); };
    await expect(atrilSearch("", {}, { exec, bin })).rejects.toThrow("atril search failed: atril: empty query");
  });

  it("output that is not JSON is an error, not a silent pass", async () => {
    await expect(atrilSearch("a", {}, { exec: async () => ({ stdout: "nope" }), bin })).rejects.toThrow(/invalid JSON/);
  });
});

describe("kj skills", () => {
  it("hands every atril command to atril, and keeps the cache actions of its own", async () => {
    const seen = [];
    const atril = ({ action, args }) => { seen.push([action, args]); return 0; };
    for (const action of ATRIL_COMMANDS) expect(await skillsCommand({ action, args: ["x"], deps: { atril } })).toBe(0);
    expect(seen.map(([a]) => a)).toEqual(ATRIL_COMMANDS);
    expect(seen.every(([, args]) => args[0] === "x")).toBe(true);
  });

  it("end to end: kj skills scan lists the store under .karajan through the real atril CLI", () => {
    const project = mkdtempSync(join(tmpdir(), "kj-skills-atril-"));
    const user = mkdtempSync(join(tmpdir(), "kj-skills-user-"));
    try {
      mkdirSync(join(project, ".karajan", "skills", "a11y"), { recursive: true });
      writeFileSync(join(project, ".karajan", "skills", "a11y", "SKILL.md"), "---\nname: a11y\ndescription: accessible forms\nkind: skill\n---\n# a11y\n");
      const res = spawnSync(process.execPath, [atrilBin(), ...atrilArgs("scan", ["--json"])], { cwd: project, encoding: "utf8", env: { ...process.env, ATRIL_USER_ROOT: user } });
      expect(res.status).toBe(0);
      expect(JSON.parse(res.stdout).artifacts.map((a) => `${a.kind}:${a.name}`)).toEqual(["skill:a11y"]);
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(user, { recursive: true, force: true });
    }
  });
});
