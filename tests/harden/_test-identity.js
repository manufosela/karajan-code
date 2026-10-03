// KJC-TSK-0927 — the identity lock has no escape (ADR 0015), so a test that
// runs gh or a mutating git through the Sentinel declares the identity it
// runs as, the way a real clone does, and gets the env that matches it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TEST_GH_USER = "kj-tester";
export const TEST_GIT_EMAIL = "tester@example.invalid";

/** Declare the clone's identity in `dir`; returns the env of a session that matches it. */
export function declareTestIdentity(dir) {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "identity.local.yml"), `gh_user: ${TEST_GH_USER}\ngit_email: ${TEST_GIT_EMAIL}\n`);
  const ghConfig = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gh-"));
  fs.writeFileSync(path.join(ghConfig, "hosts.yml"), `github.com:\n    user: ${TEST_GH_USER}\n`);
  return {
    GH_CONFIG_DIR: ghConfig,
    GIT_AUTHOR_NAME: "tester", GIT_AUTHOR_EMAIL: TEST_GIT_EMAIL,
    GIT_COMMITTER_NAME: "tester", GIT_COMMITTER_EMAIL: TEST_GIT_EMAIL,
  };
}
