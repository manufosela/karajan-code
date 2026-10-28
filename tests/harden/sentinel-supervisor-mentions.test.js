// KJC-BUG-0425 (issue #2679, ADR 0036): a PR description that NAMES the supervisor's
// files is not a write to them. Text a command only publishes (gh pr/issue/release,
// quoted values or a quoted heredoc read from stdin) is text; anything the guard
// cannot prove inert is still denied (fail closed).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { stripTextOnlyCommandValues } from "../../src/harden/sentinel/sentinel-shell.mjs";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";

const HOOK = [".karajan", "hooks", "pre-commit"].join("/");
const HEREDOC_PR = `gh pr create --title 'seal' --body-file - <<'EOF'\nThe seal regenerates ${HOOK} and .claude/settings.json.\nEOF`;

describe("stripTextOnlyCommandValues × gh and quoted heredocs", () => {
  it("blanks the quoted text of gh pr/issue/release commands", () => {
    expect(stripTextOnlyCommandValues(`gh pr create --title 'seal' --body 'regenerates ${HOOK}'`)).toBe(`gh pr create --title '' --body ''`);
    expect(stripTextOnlyCommandValues(`gh issue comment 12 --body "touches ${HOOK}"`)).toBe(`gh issue comment 12 --body ""`);
  });

  it("drops the body of a quoted heredoc that a text-only command reads from stdin", () => {
    expect(stripTextOnlyCommandValues(HEREDOC_PR)).toBe(`gh pr create --title '' --body-file -`);
    expect(stripTextOnlyCommandValues(`git commit -F - <<"MSG"\nchore: seal ${HOOK}\nMSG`)).toBe(`git commit -F -`);
  });

  it("keeps whole what may run or write: unquoted heredocs, other commands, redirections, chains", () => {
    for (const cmd of [
      `gh pr create --body-file - <<EOF\n$(cp x ${HOOK})\nEOF`,
      `cat <<'EOF' > ${HOOK}\nexit 0\nEOF`,
      `gh pr create --title 'x' <<'EOF' > ${HOOK}\ntext\nEOF`,
      `gh pr create --body-file - <<'EOF'\ntext\nEOF\ncp x ${HOOK}`,
      // the shell ends the heredoc at the FIRST delimiter line and runs what follows
      `gh pr create --body-file - <<'EOF'\ntext\nEOF\ncp x ${HOOK}\nEOF`,
      `gh pr create --title 'x' <<'EOF'\n${HOOK}\nEOF`,
      `gh pr create --title 'x' ; cp x ${HOOK}`,
      `gh api repos/o/r --input ${HOOK}`,
    ]) {
      expect(stripTextOnlyCommandValues(cmd), cmd).toContain(HOOK);
    }
  });
});

describe("the supervisor guard (PreToolUse Bash)", () => {
  let dir, pre;
  const bash = (command) => spawnSync("node", [pre], { input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command } }), encoding: "utf8", cwd: dir, env: { ...process.env } });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sup-mentions-"));
    execSync("git init -q -b fix/KJC-BUG-0001-x", { cwd: dir });
    installSentinelHooks({ projectDir: dir });
    placeGuardCopies(dir);
    pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("lets a PR describe the supervisor's files", () => {
    for (const cmd of [HEREDOC_PR, `gh pr create --title 'seal' --body 'regenerates ${HOOK}'`]) {
      expect(bash(cmd).stderr, cmd).not.toMatch(/ficheros del supervisor/);
    }
  });

  it("still denies every command that may write them", () => {
    for (const cmd of [`cp x ${HOOK}`, `cat <<'EOF' > ${HOOK}\nexit 0\nEOF`, `gh pr create --title 'x' ; rm ${HOOK}`, `gh pr create --body-file - <<EOF\n$(cp x ${HOOK})\nEOF`, `gh pr create --body-file - <<'EOF'\ntext\nEOF\ncp x ${HOOK}\nEOF`]) {
      const r = bash(cmd);
      expect(r.status, cmd).toBe(2);
      expect(r.stderr, cmd).toMatch(/karajan sentinel/);
    }
  });
});
