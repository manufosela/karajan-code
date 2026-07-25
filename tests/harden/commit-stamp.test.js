// KJC-TSK-0692 (MG-F) — field case: "commits with card ref 0/4" while the
// agent asked whether to adopt the convention. A convention that enforces
// itself needs no adoption: prepare-commit-msg stamps the branch's card
// ref into the subject. Functional tests run the REAL generated script.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { hookBody, PROFILE_HOOKS } from "../../src/harden/hook-templates.js";

let dir, script;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-stamp-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a"), "x");
  git("add", "a"); git("commit", "-qm", "base");
  script = path.join(dir, "prepare-commit-msg.sh");
  fs.writeFileSync(script, `#!/bin/sh\n${hookBody("prepare-commit-msg", {}, {})}\n`);
  fs.chmodSync(script, 0o755);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const onBranch = (name) => execFileSync("git", ["-C", dir, "checkout", "-qb", name]);
const runHook = (message) => {
  const msgFile = path.join(dir, "MSG");
  fs.writeFileSync(msgFile, message);
  execFileSync("sh", [script, msgFile], { cwd: dir });
  return fs.readFileSync(msgFile, "utf8");
};

describe("prepare-commit-msg card stamp", () => {
  it("stamps the branch's card ref into a bare subject (uppercased)", () => {
    onBranch("feat/kjw-tsk-0001-validator");
    expect(runHook("feat: add validator\n")).toBe("feat: add validator (KJW-TSK-0001)\n");
  });

  it("does not duplicate when the subject already carries the ref (any case)", () => {
    onBranch("feat/KJW-TSK-0001-validator");
    expect(runHook("feat: add validator (kjw-tsk-0001)\n")).toBe("feat: add validator (kjw-tsk-0001)\n");
  });

  it("leaves merges, refless branches and over-limit headers untouched", () => {
    onBranch("feat/KJW-TSK-0001-x");
    expect(runHook("Merge branch 'main'\n")).toBe("Merge branch 'main'\n");
    const long = `feat: ${"x".repeat(90)}`;
    expect(runHook(`${long}\n`)).toBe(`${long}\n`); // stamping would exceed 100
    onBranch("feat/sin-referencia");
    expect(runHook("feat: cosa\n")).toBe("feat: cosa\n");
    // the numeric suffix needs a real delimiter — kjc-tsk-0692x is NOT
    // a reference to kjc-tsk-0692 (reviewer catch)
    onBranch("feat/kjc-tsk-0692x");
    expect(runHook("feat: cosa\n")).toBe("feat: cosa\n");
  });

  it("a header mentioning a LONGER id still gets the branch's stamp (boundary match)", () => {
    onBranch("feat/KJW-TSK-0001-x");
    expect(runHook("feat: relates to KJW-TSK-00011\n")).toBe("feat: relates to KJW-TSK-00011 (KJW-TSK-0001)\n");
  });

  it("preserves the message body below the subject", () => {
    onBranch("feat/KJW-TSK-0002-y");
    expect(runHook("fix: y\n\nbody line\n")).toBe("fix: y (KJW-TSK-0002)\n\nbody line\n");
  });

  it("ships in the standard and strict profiles", () => {
    expect(PROFILE_HOOKS.standard).toContain("prepare-commit-msg");
    expect(PROFILE_HOOKS.strict).toContain("prepare-commit-msg");
    expect(PROFILE_HOOKS.minimal).not.toContain("prepare-commit-msg");
  });
});
