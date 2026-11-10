// KJC-BUG-0538 (#3763): without kj on the PATH (an IDE commit, a shell without nvm's node) the
// commit-msg hook fell back to conventional, and rejected "TICKET-ID: Short title" in a project
// whose convention is free. kj harden now writes the project's convention into the hook.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveCommitConvention } from "../../src/commands/harden.js";
import { renderCanonicalHook } from "../../src/harden/harden-engine.js";
import { hookBody } from "../../src/harden/hook-templates.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-baked-conv-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the commit-msg hook on `message` with a PATH that has no kj. */
const runHook = (generation, message) => {
  writeFileSync(join(dir, "commit-msg"), `#!/bin/sh\n${hookBody("commit-msg", {}, generation)}\n`, { mode: 0o755 });
  writeFileSync(join(dir, "MSG"), message);
  return spawnSync("/bin/sh", [join(dir, "commit-msg"), join(dir, "MSG")], { cwd: dir, encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
};

describe("commit-msg keeps the project's convention without kj (KJC-BUG-0538)", () => {
  it("free, written in by kj harden: a ticket-style header passes with no kj on the PATH", () => {
    expect(runHook({ commitConvention: "free" }, "ABC-123: Short title\n").status).toBe(0);
  });

  it("with no convention given it stays conventional, as before", () => {
    const res = runHook({}, "ABC-123: Short title\n");
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/Conventional Commits/);
  });

  it("the default renders the same bytes as before, so older seals still verify", () => {
    expect(renderCanonicalHook("commit-msg", { commitConvention: "conventional" })).toBe(renderCanonicalHook("commit-msg", {}));
    expect(renderCanonicalHook("commit-msg", { commitConvention: "free" })).not.toBe(renderCanonicalHook("commit-msg", {}));
  });

  it("kj harden resolves it from the project's kj config", async () => {
    mkdirSync(join(dir, ".karajan"));
    writeFileSync(join(dir, ".karajan", "kj.config.yml"), "method_gates:\n  commit_convention: free\n");
    expect(await resolveCommitConvention(dir)).toBe("free");
  });

  it("refuses a convention that is not one kj knows", () => {
    expect(() => hookBody("commit-msg", {}, { commitConvention: "free; rm -rf ." })).toThrow(/commit-convention/);
  });
});
