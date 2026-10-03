// KJC-BUG-0243: the lane guard took quoted TEXT for paths and inert quotes for
// operators: gh pr create --title "a edit/write b", grep -e "command(", commit
// messages with a slash. Narrow exemption: inert quoted text (single quotes, or
// double quotes with no $ or backtick) and the values of known text options.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { stripInertQuotes, stripTextOptionValues } from "../../src/harden/sentinel/sentinel-shell.mjs";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

describe("stripInertQuotes / stripTextOptionValues", () => {
  it("blanks quoted text that does not run, keeps what does", () => {
    expect(stripInertQuotes(`grep -e "command(" -e 'a|b' f`)).toBe(`grep -e "" -e '' f`);
    expect(stripInertQuotes(`echo "$(rm x)"`)).toBe(`echo "$(rm x)"`);
    expect(stripInertQuotes("echo 'uses `x`'")).toBe("echo ''");
  });

  it("blanks the values of text options only", () => {
    expect(stripTextOptionValues(`gh pr create --title "a edit/write b" --body-file /tmp/b.md`)).toBe(`gh pr create --title "" --body-file /tmp/b.md`);
    expect(stripTextOptionValues(`git commit -m 'fix a/b thing'`)).toBe(`git commit -m ''`);
    expect(stripTextOptionValues(`cp "/other lane/x.js" y`)).toBe(`cp "/other lane/x.js" y`);
    expect(stripTextOptionValues(`git commit -m "$(cat /tmp/m)"`)).toBe(`git commit -m "$(cat /tmp/m)"`);
  });
});

describe("the lane guard with quoted text (PreToolUse Bash)", () => {
  let dir, pre;
  const bash = (command) => spawnSync("node", [pre], { input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command } }), encoding: "utf8", cwd: dir, env: { ...process.env, KJ_ALLOW_IDENTITY: "1" } });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-lane-text-"));
    execSync("git init -q -b feat/KJC-TSK-0001-x", { cwd: dir });
    installSentinelHooks({ projectDir: dir });
    pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("lets text through", () => {
    const body = path.join(dir, "body.md");
    fs.writeFileSync(body, "plain\n");
    // KJC-BUG-0260: the position given to solomon is prose too.
    for (const cmd of [`gh pr create --title "repo files through edit/write only" --body-file ${body}`, `grep -n -F -e "command(" -e "a|b" src`, `git commit -m 'docs: the a/b guide'`, `kj solomon --position "the reviewer misreads src/a.js and the test"`]) {
      const r = bash(cmd);
      expect(r.stderr, cmd).not.toContain("entrecomillada");
    }
  });

  it("still denies real quoted paths, substitutions and unclosed quotes", () => {
    for (const cmd of [`cp "/otro carril/x.js" y.js`, `git commit -m "$(cat /tmp/m)"`, `git commit -m "a medias`]) expect(bash(cmd).status, cmd).toBe(2);
  });
});
