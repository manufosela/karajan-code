// KJC-BUG-0354: the human-act guards (kj harden --commit, phone enrollment) read
// the raw command, so a commit message or a card title that only MENTIONED them
// was denied. The maintainer's choice: the quoted values of text options are text
// only in commands that just store text (kj hu add, kj adr add, git commit).
// Anywhere else, a quoted value may be run (flock --command '...'): still denied.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { stripTextOnlyCommandValues } from "../../src/harden/sentinel/sentinel-shell.mjs";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";

const HC = ["kj", "harden", "--commit"].join(" ");
const ENROLL = ["kj", "identity", "enroll-phone"].join(" ");

describe("stripTextOnlyCommandValues", () => {
  it("blanks the quoted text values of kj hu add, kj adr add and git commit only", () => {
    expect(stripTextOnlyCommandValues(`kj hu add 'avoid ${HC}'`)).toBe(`kj hu add ''`);
    expect(stripTextOnlyCommandValues(`kj adr add 'a' --decision 'run ${ENROLL}'`)).toBe(`kj adr add '' --decision ''`);
    expect(stripTextOnlyCommandValues(`git -c user.name=x commit -m 'mentions ${HC}'`)).toBe(`git -c user.name=x commit -m ''`);
    expect(stripTextOnlyCommandValues(`git -C /repo --no-pager -c a=b commit -m 'mentions ${HC}'`)).toBe(`git -C /repo --no-pager -c a=b commit -m ''`);
    expect(stripTextOnlyCommandValues(`git --git-dir /r/.git --work-tree=/r commit -m 'mentions ${HC}'`)).toBe(`git --git-dir /r/.git --work-tree=/r commit -m ''`);
    // any other git subcommand is not text-only
    expect(stripTextOnlyCommandValues(`git -C /repo notes add -m '${HC}'`)).toBe(`git -C /repo notes add -m '${HC}'`);
  });

  it("leaves every other input whole: other commands, chains, functions, redirections", () => {
    for (const cmd of [`flock /tmp/l --command '${HC}'`, `echo '${HC}'`, `kj hu add 'x' ; ${HC}`, `cd /r && git commit -m '${HC}'`, `kj(){ eval "command $3"; }; kj hu add '${HC}'`, `git commit -m '${HC}' > /tmp/out`]) {
      expect(stripTextOnlyCommandValues(cmd), cmd).toBe(cmd);
    }
    // an operator inside the stored text is text: it does not cut the segment
    expect(stripTextOnlyCommandValues(`git commit -m 'note; ${HC} && more'`)).toBe(`git commit -m ''`);
  });

  it("never blanks a value the shell would expand: a substitution inside double quotes runs", () => {
    for (const cmd of [`kj hu add "$(${HC})"`, `git commit -m "$(${HC})"`, `kj adr add 'x' --decision "\`${HC}\`"`, `kj hu add "$(true; ${HC})"`]) {
      expect(stripTextOnlyCommandValues(cmd), cmd).toContain(HC);
    }
  });
});

describe("the human-act guards with quoted text (PreToolUse Bash)", () => {
  let dir, pre;
  const bash = (command) => spawnSync("node", [pre], { input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command } }), encoding: "utf8", cwd: dir, env: { ...process.env } });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-text-only-"));
    execSync("git init -q -b fix/KJC-BUG-0001-x", { cwd: dir });
    installSentinelHooks({ projectDir: dir });
    placeGuardCopies(dir);
    pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("lets a title, a decision or a commit message mention them", () => {
    for (const cmd of [`kj hu add 'the Sentinel denies ${HC} in a title'`, `kj adr add 'phone' --decision 'the human runs ${ENROLL}'`, `git commit -m 'docs: ${HC} is a human act'`, `git commit -m 'note; ${HC} | only text'`]) {
      const r = bash(cmd);
      expect(r.stderr, cmd).not.toMatch(/acto humano/);
    }
  });

  // KJC-TSK-1084 (ADR 0015): running them is refused by the commands themselves
  // (src/harden/human-act.js: a kj launched by the agent descends from it, however
  // it is chained or quoted); the Sentinel no longer reads their text.
});
