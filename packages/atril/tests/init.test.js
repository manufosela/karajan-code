// ADR 0021, decision 13 and plan step 12c: `atril init` offers the recommended set's available
// entries, from the flags or asked one by one, and hands the answers to applyRecommended.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answersFor, askAnswers } from "../src/init.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
const entries = [
  { kind: "command", name: "plan", description: "plan things", state: "available" },
  { kind: "skill", name: "lint", description: "lint code", state: "available" },
  { kind: "command", name: "ship", description: "ship things", state: "persistent" },
  { kind: "command", name: "test", description: "test things", state: "changed" },
];

describe("answersFor", () => {
  it("is null when the flags decide nothing, so init asks", () => {
    expect(answersFor(entries, {})).toBeNull();
  });

  it("--yes answers on-demand for the available entries only", () => {
    expect(answersFor(entries, { yes: true })).toEqual({ "command:plan": "on-demand", "skill:lint": "on-demand" });
  });

  it("--recommended answers its value, none being skip, and wins over --yes", () => {
    expect(answersFor(entries, { recommended: "persistent", yes: true })).toEqual({ "command:plan": "persistent", "skill:lint": "persistent" });
    expect(answersFor(entries, { recommended: "on-demand" })["command:plan"]).toBe("on-demand");
    expect(answersFor(entries, { recommended: "none" })).toEqual({ "command:plan": "skip", "skill:lint": "skip" });
  });

  it("an unknown --recommended fails", () => {
    for (const value of ["all", "toString", ""]) expect(() => answersFor(entries, { recommended: value })).toThrow(/--recommended must be one of on-demand, persistent, none/);
  });
});

describe("askAnswers", () => {
  const replying = (...replies) => {
    const asked = [];
    return { asked, ask: async (question) => { asked.push(question); return replies.shift(); } };
  };

  it("asks each available entry; Enter is on demand, o, p and s choose", async () => {
    const { asked, ask } = replying("", "P");
    expect(await askAnswers(entries, ask)).toEqual({ "command:plan": "on-demand", "skill:lint": "persistent" });
    expect(asked).toEqual([
      "command:plan — plan things [o]n demand (default) / [p]ersistent / [s]kip?",
      "skill:lint — lint code [o]n demand (default) / [p]ersistent / [s]kip?",
    ]);
    expect(await askAnswers(entries, replying(" s ", "o").ask)).toEqual({ "command:plan": "skip", "skill:lint": "on-demand" });
  });

  it("an answer it does not know asks again", async () => {
    const { asked, ask } = replying("x", "constructor", "s", "");
    expect(await askAnswers(entries, ask)).toEqual({ "command:plan": "skip", "skill:lint": "on-demand" });
    expect(asked).toHaveLength(4);
  });

  it("a question that fails (EOF) fails the whole, with no partial answers", async () => {
    await expect(askAnswers(entries, async () => { throw new Error("closed"); })).rejects.toThrow("closed");
  });
});

describe("atril init", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atril-init-"));
    const command = (path, name, body = "body") => {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), `---\nname: ${name}\ndescription: ${name} things\nkind: command\n---\n${body}\n`);
    };
    command("set/commands/plan.md", "plan");
    command("set/commands/test.md", "test");
    command("store/commands/test.md", "test", "edited");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [BIN, "init", "--root", "store", ...args], {
    cwd: dir, encoding: "utf8", input: "",
    env: { ...process.env, ATRIL_USER_ROOT: join(dir, "no-user-store"), ATRIL_RECOMMENDED: join(dir, "set") },
  });

  it("--recommended=none skips every available entry and reports the changed one", () => {
    const res = run("--recommended=none");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("skipped\tcommand:plan\nchanged\tcommand:test\tchanged in this version, not touched: run atril update\n"
      + "0 installed, 0 exposed, 1 skipped, 1 changed\n");
  });

  it("--yes installs on demand; --json prints what was applied", () => {
    expect(JSON.parse(run("--yes", "--json").stdout)).toEqual({ installed: ["command:plan"], exposed: [], skipped: [], changed: ["command:test"] });
    expect(run("--yes").stdout).toMatch(/^nothing new to offer/);
  });

  it("without a terminal and without --yes or --recommended it fails and applies nothing", () => {
    const res = run();
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/init needs a terminal to ask: pass --yes or --recommended=on-demand\|persistent\|none/);
    expect(JSON.parse(run("--recommended=none", "--json").stdout).skipped).toEqual(["command:plan"]);
  });
});
