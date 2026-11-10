// HU-3730: the commit-msg hook and `kj review --third-party` judge the Conventional Commits
// header with ONE pattern, so a header gets the same verdict from both. Commitlint's
// `conventional` config: a scope, when written, is not empty; the subject does not start blank.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONVENTIONAL_HEADER, hookBody } from "../../src/harden/hook-templates.js";
import { commitChecks } from "../../src/review/pr-requirements.js";

let dir;
let env;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-header-"));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  mkdirSync(join(dir, "hooks"));
  writeFileSync(join(dir, "hooks", "commit-msg"), `#!/bin/sh\n${hookBody("commit-msg", {}, {})}\n`, { mode: 0o755 });
  git("config", "core.hooksPath", join(dir, "hooks"));
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.com");
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "kj"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  env = { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}` };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const hookAccepts = (header) => {
  writeFileSync(join(dir, "MSG"), `${header}\n`);
  return spawnSync("git", ["commit", "-q", "--allow-empty", "-F", "MSG"], { cwd: dir, encoding: "utf8", env }).status === 0;
};
const reviewAccepts = (header) => commitChecks([{ sha: "0".repeat(8), subject: header, body: "" }]).find((c) => c.id === "conventional-commits").ok;

const HEADERS = [
  ["feat: add thing", true],
  ["fix(core): handle x", true],
  ["refactor(a b)!: drop y", true],
  ["fix(): x", false],
  ["fix:  x", false],
  ["fix: ", false],
  ["fix: \tx", false],
  ["fixx: x", false],
];

describe("one header pattern", () => {
  it.each(HEADERS)("%j: same verdict from the hook and from kj review", (header, valid) => {
    expect(hookAccepts(header), "hook").toBe(valid);
    expect(reviewAccepts(header), "review").toBe(valid);
  });

  it("exports the pattern both consumers use", () => {
    expect(new RegExp(CONVENTIONAL_HEADER).test("feat(x): y")).toBe(true);
  });
});
