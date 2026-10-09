// KJC-TSK-0992 (HUM-G, ADR 0018): the signing page shows sha256 and a project
// name; a person cannot read "what changes" from that. kj now describes each
// supervisor file it regenerated: status, lines, a summary and the diff.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DIFF_LIMIT_PER_FILE, DIFF_LIMIT_TOTAL, describeSupervisorChanges } from "../../src/harden/sign-changes.js";

let dir;
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
const write = (rel, text) => { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), text); };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-sign-changes-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  write(".karajan/hooks/pre-commit", "#!/bin/sh\n# sealed v1\nexit 0\n");
  write(".karajan/hooks/pre-push", "#!/bin/sh\nexit 0\n");
  git("add", "-A");
  git("commit", "-qm", "seed", "--no-verify");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("describeSupervisorChanges", () => {
  it("says new, modified and deleted, with the lines, the first added comment as summary and the diff", () => {
    write(".karajan/hooks/pre-commit", "#!/bin/sh\n# KJC-BUG-0302: a regenerated sealed supervisor is the seal's\n# sealed v1\nexit 0\n");
    write(".karajan/hooks/commit-msg", "#!/bin/sh\n# new guard\nexit 0\n");
    unlinkSync(join(dir, ".karajan/hooks/pre-push"));
    const out = describeSupervisorChanges({
      projectDir: dir,
      files: [{ file: ".karajan/hooks/pre-commit" }, { file: ".karajan/hooks/commit-msg" }, { file: ".karajan/hooks/pre-push", deleted: true }],
    });
    expect(out.map((c) => [c.file, c.status, c.added, c.removed])).toEqual([
      [".karajan/hooks/pre-commit", "modified", 1, 0],
      [".karajan/hooks/commit-msg", "new", 3, 0],
      [".karajan/hooks/pre-push", "deleted", 0, 2],
    ]);
    expect(out[0].summary).toBe("KJC-BUG-0302: a regenerated sealed supervisor is the seal's");
    expect(out[0].diff).toMatch(/^diff --git/);
    expect(out[0].diff).toContain("+# KJC-BUG-0302");
    expect(out[1].diff).toContain("+# new guard");
    expect(out[2].diff).toContain("-exit 0");
    expect(out.every((c) => c.truncated === false)).toBe(true);
  });

  it("cuts a diff over the per-file limit, marker included, and says how much was cut", () => {
    write(".karajan/hooks/pre-commit", `#!/bin/sh\n${"# x\n".repeat(6000)}exit 0\n`);
    const [c] = describeSupervisorChanges({ projectDir: dir, files: [{ file: ".karajan/hooks/pre-commit" }] });
    expect(c.truncated).toBe(true);
    expect(c.diff.length).toBeLessThanOrEqual(DIFF_LIMIT_PER_FILE);
    expect(c.diff).toMatch(/\[cut: \d+ more characters\]$/);
  });

  it("the total never exceeds the overall limit: with the budget spent, a later file gets one bounded marker", () => {
    const big = `#!/bin/sh\n${"# y\n".repeat(6000)}exit 0\n`;
    const files = [];
    for (let i = 0; i < 40; i++) { write(`.karajan/hooks/h${i}`, big); files.push({ file: `.karajan/hooks/h${i}` }); }
    const out = describeSupervisorChanges({ projectDir: dir, files });
    const total = out.reduce((n, c) => n + c.diff.length, 0);
    expect(total).toBeLessThanOrEqual(DIFF_LIMIT_TOTAL);
    expect(out.at(-1).truncated).toBe(true);
    expect(out.at(-1).diff.length).toBeLessThanOrEqual(60);
  });

  it("a diff the privacy scan flags is withheld, never published", () => {
    write(".karajan/hooks/pre-commit", "#!/bin/sh\n# contact me@example.test\nexit 0\n");
    const scan = () => [{ severity: "block", kind: "email" }];
    const [c] = describeSupervisorChanges({ projectDir: dir, files: [{ file: ".karajan/hooks/pre-commit" }], scan });
    expect(c.diff).toMatch(/diff withheld: the privacy scan found 1 sensitive item/);
    expect(c.diff).not.toContain("example.test");
  });
});
