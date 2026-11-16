// KJC-BUG-0604 (HU-4398, ADR accepted 15-nov): in a repo whose pre-commit runs prettier --check,
// the first kj harden could not commit its contract: AGENTS.md, .gemini/settings.json and
// commitlint.config.js were not prettier-clean. kj now formats what it generated with the repo's
// own prettier before the commit; the sealed files keep the bytes kj wrote.
// The prettier here is a double in node_modules/.bin: it marks each file it is given.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { commitContract, commitContractReviewed } from "../../src/environment/contract-commit.js";

let dir;
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const read = (rel) => git("show", `HEAD:${rel}`);
const fakePrettier = (body) => {
  write("node_modules/.bin/prettier", `#!/bin/sh\n${body}\n`);
  fs.chmodSync(path.join(dir, "node_modules/.bin/prettier"), 0o755);
};
// Marks every file after `--`, as a formatter rewriting it would.
const MARKING = 'seen=0; for f in "$@"; do if [ "$seen" = 1 ]; then echo "formatted" >> "$f"; fi; [ "$f" = "--" ] && seen=1; done; exit 0';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-contract-format-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "T");
  write(".gitignore", "node_modules/\n");
  git("add", ".gitignore");
  git("commit", "-q", "-m", "chore: init");
  git("checkout", "-q", "-b", "chore/kj");
  write("AGENTS.md", "# rules\n");
  write(".github/workflows/kj-policy.yml", "name: kj\n");
  write(".karajan/review-gate", "x\n");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the contract formatted by the repo's prettier (KJC-BUG-0604)", () => {
  it("formats the files kj generated before committing them, and leaves the sealed ones as kj wrote them", () => {
    fakePrettier(MARKING);
    expect(commitContract({ projectDir: dir }).committed).toBe(true);
    expect(read("AGENTS.md")).toBe("# rules\nformatted\n");
    expect(read(".karajan/review-gate")).toBe("x\n");
    // KJC-BUG-0608: with history the workflow is the seal's; on disk it keeps kj's bytes for it.
    expect(fs.readFileSync(path.join(dir, ".github/workflows/kj-policy.yml"), "utf8")).toBe("name: kj\n");
  });

  it("the review reads the formatted contract, the one that is committed", async () => {
    fakePrettier(MARKING);
    let reviewed = "";
    const reviewStaged = ({ indexFile }) => {
      reviewed = execFileSync("git", ["-C", dir, "show", ":AGENTS.md"], { encoding: "utf8", env: { ...process.env, GIT_INDEX_FILE: indexFile } });
      return Promise.resolve({ status: "approved" });
    };
    expect((await commitContractReviewed({ projectDir: dir, reviewStaged })).committed).toBe(true);
    expect(reviewed).toBe("# rules\nformatted\n");
  });

  it("a prettier that fails commits nothing and names its own line", () => {
    fakePrettier("echo '[error] AGENTS.md: SyntaxError' >&2; exit 2");
    const res = commitContract({ projectDir: dir });
    expect(res.committed).toBe(false);
    expect(res.reason).toMatch(/the repo's prettier could not format.*\[error\] AGENTS\.md: SyntaxError/);
    expect(git("diff", "--cached", "--name-only").trim()).toBe("");
  });

  it("without prettier in the repo, the contract is committed as kj wrote it", () => {
    expect(commitContract({ projectDir: dir }).committed).toBe(true);
    expect(read("AGENTS.md")).toBe("# rules\n");
  });
});
