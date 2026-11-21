// HU-4482: kj review --staged stores the verdict under the hash of the diff printed with kj's
// pinned format (src/utils/git-diff-format.js). The Sentinel ran a plain `git diff --cached`, so
// a user's diff.algorithm=histogram gave it another hash and it refused a reviewed commit.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PINS, pinGitDiffFormat } from "../../src/utils/git-diff-format.js";
import { DIFF_PINS } from "../../src/harden/sentinel/sentinel-lib.mjs";

const LIB = fileURLToPath(new URL("../../src/harden/sentinel/sentinel-lib.mjs", import.meta.url));
const PROBE = "const m = await import(process.argv[1]); console.log(JSON.stringify(m.stagedVerdict(process.argv[2])));";

// The environment the tests inherit is already pinned (tests/setup.js): the Sentinel must not rely on it.
const unpinned = () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_CONFIG_") || key === "KJ_GIT_DIFF_PINNED") delete env[key];
  return env;
};

// Two inputs whose diff differs between myers and histogram.
const OLD = ["a", "b", "c", "a", "b", "b", "a"];
const NEW = ["c", "b", "a", "b", "a", "c"];
const text = (lines) => lines.join("\n") + "\n";

let dir;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("stagedVerdict pins the diff format kj review hashes", () => {
  it("finds the verdict stored under the pinned hash whatever the user's diff.algorithm", () => {
    dir = mkdtempSync(join(tmpdir(), "kj-sentinel-pins-"));
    const clean = unpinned();
    const git = (args, env = clean) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
    git(["init", "-q"]);
    git(["config", "user.name", "t"]);
    git(["config", "user.email", "t@example.invalid"]);
    mkdirSync(join(dir, ".karajan"));
    writeFileSync(join(dir, ".karajan", "review-gate"), "");
    writeFileSync(join(dir, "f.txt"), text(OLD));
    git(["add", "."]);
    git(["commit", "-q", "-m", "init"]);
    git(["config", "diff.algorithm", "histogram"]);
    writeFileSync(join(dir, "f.txt"), text(NEW));
    git(["add", "f.txt"]);
    const pinned = git(["diff", "--cached"], pinGitDiffFormat({ ...clean }));
    expect(git(["diff", "--cached"])).not.toBe(pinned);
    const hash = createHash("sha256").update(pinned.trimEnd(), "utf8").digest("hex");
    mkdirSync(join(dir, ".karajan", "reviews"));
    writeFileSync(join(dir, ".karajan", "reviews", `${hash}.json`), JSON.stringify({ verdict: "approved", reviewer: "codex" }));
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE, LIB, dir], { cwd: dir, env: clean, encoding: "utf8" });
    expect(JSON.parse(out.trim())).toEqual({ gate: true, state: "approved", reviewer: "codex" });
  });

  it("the Sentinel's pins are the ones git-diff-format.js pins", () => {
    expect(PINS.length).toBeGreaterThan(0);
    expect(DIFF_PINS).toEqual(PINS);
  });
});
