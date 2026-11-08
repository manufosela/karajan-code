// HU-3591 (KJC-BUG-0505, part 1): the generated commit-msg hook and the CI's commitlint
// (config-conventional + header-max-length 100) must judge a message the same way.
// Narrow on purpose: no emulation of git's message cleanup, only the header ignores.
// Here the real `git commit` runs the hook.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hookBody } from "../../src/harden/hook-templates.js";

let dir;
let env;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-parity-"));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  mkdirSync(join(dir, "hooks"));
  writeFileSync(join(dir, "hooks", "commit-msg"), `#!/bin/sh\n${hookBody("commit-msg", {}, {})}\n`, { mode: 0o755 });
  git("config", "core.hooksPath", join(dir, "hooks"));
  // The probe is about the message, not the author: pin an identity. Only commit-msg is installed.
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.com");
  // kj tells the hook the project's convention; one that cannot answer keeps the default anywhere.
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "kj"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  env = { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}` };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// What a commit came to: ACCEPTED, or "refused: " and what the hook said, which names the rule.
const ACCEPTED = "accepted";
const verdict = (args, extraEnv = {}) => {
  const res = spawnSync("git", ["commit", "-q", "--allow-empty", ...args], { cwd: dir, encoding: "utf8", env: { ...env, ...extraEnv } });
  return res.status === 0 ? ACCEPTED : `refused: ${res.stdout}${res.stderr}`;
};
// -F: no editor, so git stores every line, the # ones included.
const commit = (message) => {
  writeFileSync(join(dir, "MSG"), message);
  return verdict(["-F", "MSG"]);
};

describe("commit-msg hook agrees with commitlint: header", () => {
  it("counts the header in UTF-16 units, not bytes (100 chars with multibyte letters)", () => {
    expect(commit(`feat: ${"ñ".repeat(94)}\n`)).toBe(ACCEPTED);
    expect(commit(`feat: ${"ñ".repeat(95)}\n`)).toMatch(/exceeds 100/);
  });

  it("counts an astral character as two UTF-16 units", () => {
    expect(commit(`feat: ${"😀".repeat(47)}\n`)).toBe(ACCEPTED);
    expect(commit(`feat: ${"😀".repeat(48)}\n`)).toMatch(/exceeds 100/);
  });

  it("lets what commitlint ignores through whole (git's own headers, a version): no length cap", () => {
    expect(commit("Merge branch 'main' into feat/x\n")).toBe(ACCEPTED);
    expect(commit("fixup! feat: x\n")).toBe(ACCEPTED);
    expect(commit("amend! feat: x\n")).toBe(ACCEPTED);
    expect(commit("fixup!\n")).toBe(ACCEPTED);
    expect(commit("fixup!x\n")).toBe(ACCEPTED);
    expect(commit('Revert "feat: x"\n')).toBe(ACCEPTED);
    expect(commit(`Merge branch '${"a".repeat(100)}' into main\n\n${"b".repeat(120)}\n`)).toBe(ACCEPTED);
  });


  it("accepts any scope but a closing parenthesis, spaces included", () => {
    expect(commit("feat(a b): x\n")).toBe(ACCEPTED);
    expect(commit("feat(a)b): x\n")).toMatch(/Conventional Commits/);
  });

  it("refuses a subject that starts uppercase (sentence, start, pascal and upper case)", () => {
    for (const subject of ["Add thing", "Add Thing", "AddThing", "ADD THING"]) {
      expect(commit(`feat: ${subject}\n`), subject).toMatch(/start in lowercase/);
    }
  });

  it("refuses a subject that ends in a full stop, trailing blanks git strips aside; an ellipsis is none", () => {
    expect(commit("feat: add thing.\n")).toMatch(/full stop/);
    expect(commit("feat: add thing. \n")).toMatch(/full stop/);
    expect(commit("feat: add thing...\n")).toBe(ACCEPTED);
  });
});

describe("commit-msg hook agrees with commitlint: body", () => {
  it("line 2 that is not blank is body: over 100 characters it is refused", () => {
    expect(commit(`feat: x\n${"a".repeat(120)}\n`)).toMatch(/body line/);
  });

  it("# lines are skipped on purpose: git strips them from editor commits", () => {
    expect(commit(`feat: x\n\n# ${"a".repeat(120)}\n`)).toBe(ACCEPTED);
  });

  it("a merge-like BODY line does not exempt a conventional header", () => {
    expect(commit(`feat: x\n\nMerge branch x\n${"b".repeat(120)}\n`)).toMatch(/body line/);
  });

  it("counts a body line in characters too: 100 multibyte letters pass", () => {
    expect(commit(`feat: x\n\n${"ñ".repeat(100)}\n`)).toBe(ACCEPTED);
    expect(commit(`feat: x\n\n${"ñ".repeat(101)}\n`)).toMatch(/body line/);
  });
});
