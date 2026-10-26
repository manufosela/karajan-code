// KJC-BUG-0408 (#2560): kj parses the diffs git prints for it, and a user's diff.mnemonicPrefix
// (or noprefix, or srcPrefix) changed their headers under every parser. kj pins the format of
// the git it runs, through the environment its children inherit.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pinGitDiffFormat } from "../../src/utils/git-diff-format.js";

let dir;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("pinGitDiffFormat", () => {
  it("appends its pins after the config the environment already carries, once", () => {
    const env = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.pager", GIT_CONFIG_VALUE_0: "cat" };
    pinGitDiffFormat(env);
    pinGitDiffFormat(env);
    expect(env.GIT_CONFIG_KEY_0).toBe("core.pager");
    expect(Number(env.GIT_CONFIG_COUNT)).toBe(5);
    expect(env.GIT_CONFIG_KEY_1).toBe("diff.mnemonicPrefix");
    expect(env.GIT_CONFIG_VALUE_1).toBe("false");
  });

  it("a repo with diff.mnemonicPrefix prints a/ and b/ to kj all the same", () => {
    dir = mkdtempSync(join(tmpdir(), "kj-diff-format-"));
    const git = (args, env = process.env) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
    git(["init", "-q"]);
    git(["config", "diff.mnemonicPrefix", "true"]);
    writeFileSync(join(dir, "f.txt"), "a\n");
    git(["add", "f.txt"]);
    const clean = { ...process.env };
    for (const key of Object.keys(clean)) if (key.startsWith("GIT_CONFIG_") || key === "KJ_GIT_DIFF_PINNED") delete clean[key];
    expect(git(["diff", "--cached"], clean)).toMatch(/^diff --git c\/f\.txt i\/f\.txt$/m);
    expect(git(["diff", "--cached"], pinGitDiffFormat(clean))).toMatch(/^diff --git a\/f\.txt b\/f\.txt$/m);
  });
});
