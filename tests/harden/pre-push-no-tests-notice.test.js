// HU-3731 / KJC-TSK-1507: the pre-push hook must say when it skips the suite
// because no test command was detected. A suite skipped because CI already
// runs it is not "no command detected", so the notice stays out of that case.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hookBody } from "../../src/harden/hook-templates.js";

const NOTICE = "kj harden: tests skipped: no test command detected for this stack";
let sandbox;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "kj-prepush-notice-"));
  const repo = join(sandbox, "repo");
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function runPrePushUnderSh(body) {
  const script = join(sandbox, "pre-push");
  writeFileSync(script, `#!/bin/sh\n${body}\n`);
  return execFileSync("/bin/sh", [script], {
    cwd: join(sandbox, "repo"),
    env: { PATH: process.env.PATH, HOME: sandbox, GIT_CONFIG_NOSYSTEM: "1" },
    input: "",
    encoding: "utf8",
  });
}

describe("pre-push notice when no test command is detected", () => {
  it("prints the notice and exits 0 under /bin/sh", () => {
    const output = runPrePushUnderSh(hookBody("pre-push", {}));
    expect(output).toContain(NOTICE);
  });

  it("keeps the test command when one is detected, without the notice", () => {
    const body = hookBody("pre-push", { test: "true" });
    expect(body).toContain("true || { echo 'kj harden: tests failed'; exit 1; }");
    expect(body).not.toContain(NOTICE);
    expect(runPrePushUnderSh(body)).not.toContain(NOTICE);
  });

  it("does not print the notice when CI already runs the suite", () => {
    const body = hookBody("pre-push", { testSkippedByCi: true });
    expect(body).not.toContain("no test command detected");
    expect(body).not.toContain(NOTICE);
    expect(runPrePushUnderSh(body)).not.toContain(NOTICE);
  });
});
