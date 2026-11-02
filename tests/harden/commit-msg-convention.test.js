// KJC-TSK-1390 (ADR 0045): the commit-msg hook applies the project's commit convention
// (kj gates value commit-convention) instead of always Conventional Commits. When kj
// cannot tell, it stays strict. A fake kj at the front of PATH, never the linked one.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hookBody } from "../../src/harden/hook-templates.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-commitconv-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(message, kj) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  rmSync(join(bin, "kj"), { force: true }); // "no kj at all" must not find the previous case's fake
  if (kj !== undefined) {
    writeFileSync(join(bin, "kj"), `#!/bin/sh\n${kj}\n`);
    chmodSync(join(bin, "kj"), 0o755);
  }
  const hook = join(dir, "commit-msg");
  writeFileSync(hook, `#!/bin/sh\n${hookBody("commit-msg", {}, {})}\n`);
  writeFileSync(join(dir, "MSG"), message);
  return spawnSync("sh", [hook, join(dir, "MSG")], { cwd: dir, encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin` } });
}

const FREE_STYLE = "Add the thing the team asked for\n";

describe("commit-msg hook × commit-convention", () => {
  it("free or the project's own convention: a header that is not Conventional Commits passes", () => {
    expect(run(FREE_STYLE, "echo free").status).toBe(0);
    expect(run(FREE_STYLE, "echo project").status).toBe(0);
  });

  it("conventional, a failing kj, an unexpected answer or no kj at all: the header is checked", () => {
    for (const kj of ["echo conventional", "exit 1", "echo something-else", undefined]) {
      const res = run(FREE_STYLE, kj);
      expect(res.status, String(kj)).toBe(1);
      expect(res.stdout + res.stderr).toMatch(/Conventional Commits/);
    }
  });

  it("whatever the convention, AI attribution is still refused", () => {
    // Built at run time: the repo's own pre-commit refuses this trailer as committed content.
    const trailer = ["Co-Authored", "-By: Claude <noreply@anthropic.com>"].join("");
    const res = run(`${FREE_STYLE}\n${trailer}\n`, "echo free");
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toMatch(/AI attribution/);
  });
});
