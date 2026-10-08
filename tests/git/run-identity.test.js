// KJC-BUG-0246 (#1893): of five commits of one run, three carried one account
// and two another. The identity is resolved once, deterministically, and
// every commit of the run carries it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { identityEnv, resolveRunIdentity } from "../../src/git/run-identity.js";
import { writeIdentity } from "../../src/identity/store.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-run-identity-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// A fake `git config`: the answer per scope, a throw where git would exit 1.
const gitOf = ({ local = {}, effective = {} }) => (_dir, args) => {
  const key = args.at(-1).split(".").at(-1);
  const scope = args.includes("--local") ? local : effective;
  if (scope[key] == null) throw new Error("exit 1");
  return `${scope[key]}\n`;
};

describe("resolveRunIdentity", () => {
  it("the clone's declaration wins: its email, with the effective name", () => {
    writeIdentity(dir, { gh_user: "me", git_email: "me@declared.test" });
    const gitFn = gitOf({ effective: { name: "Me", email: "me@global.test" } });
    expect(resolveRunIdentity({ projectDir: dir, gitFn })).toEqual({ name: "Me", email: "me@declared.test", source: "declared" });
  });

  it("without a declaration, the repository's own config", () => {
    const gitFn = gitOf({ local: { name: "Repo Me", email: "me@repo.test" }, effective: { name: "Repo Me", email: "me@repo.test" } });
    expect(resolveRunIdentity({ projectDir: dir, gitFn })).toEqual({ name: "Repo Me", email: "me@repo.test", source: "repo" });
  });

  it("the global config is the last resort, and is said as such", () => {
    const gitFn = gitOf({ effective: { name: "Me", email: "me@global.test" } });
    expect(resolveRunIdentity({ projectDir: dir, gitFn })).toEqual({ name: "Me", email: "me@global.test", source: "global" });
  });

  it("nothing resolvable is null, never a guess", () => {
    expect(resolveRunIdentity({ projectDir: dir, gitFn: gitOf({}) })).toBeNull();
    expect(resolveRunIdentity({ projectDir: dir, gitFn: gitOf({ effective: { email: "x@y.z" } }) })).toBeNull();
  });
});

describe("identityEnv", () => {
  it("pins author and committer", () => {
    expect(identityEnv({ name: "Me", email: "me@x.test" })).toEqual({
      GIT_AUTHOR_NAME: "Me", GIT_AUTHOR_EMAIL: "me@x.test", GIT_COMMITTER_NAME: "Me", GIT_COMMITTER_EMAIL: "me@x.test",
    });
  });
});
