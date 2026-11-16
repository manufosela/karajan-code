// KJC-BUG-0624 (#4486): publish-pr and CI judge a commit's files as the commit gate does, so a
// config kj harden writes (only kj's managed block) is no Sonar source there either.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitFiles } from "../../src/review/publish-pr.js";
import { runCommand } from "../../src/utils/process.js";

let repo;
const git = (...args) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();
const MANAGED = "// >>> kj:managed:commitlint\nexport default { extends: [\"@commitlint/config-conventional\"] };\n// <<< kj:managed:commitlint\n";
const commit = (files) => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(repo, file, ".."), { recursive: true });
    writeFileSync(join(repo, file), text);
  }
  git("add", ".");
  git("commit", "-qm", "c");
  return git("rev-parse", "HEAD");
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-commit-files-"));
  git("init", "-q");
  commit({ "README.md": "r\n" });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("commitFiles", () => {
  it("names generated the config kj writes in a nested package, made of its managed block alone", async () => {
    const sha = commit({ "functions/commitlint.config.js": MANAGED, "functions/index.js": "export const a = 1;\n" });
    const { files, generated } = await commitFiles(repo, sha, runCommand);
    expect(files.toSorted()).toEqual(["functions/commitlint.config.js", "functions/index.js"]);
    expect([...generated]).toEqual(["functions/commitlint.config.js"]);
  });
  it("keeps under the gates a config of that name with a line written by hand", async () => {
    const sha = commit({ "commitlint.config.js": `${MANAGED}export const extra = true;\n` });
    expect([...(await commitFiles(repo, sha, runCommand)).generated]).toEqual([]);
  });
});
