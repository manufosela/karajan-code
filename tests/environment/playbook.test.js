// ENV-A1 (KJC-TSK-0639): one source renders the Karajan method for every
// host agent. The playbook is agent CONTEXT — the tests cap its size so it
// stays signal, and pin the invariants: never touch user content outside
// the managed block, idempotent re-install, method steps present.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderPlaybook, installPlaybook, PLAYBOOK_TARGETS } from "../../src/environment/playbook.js";

describe("renderPlaybook", () => {
  for (const target of ["claude", "codex", "gemini"]) {
    it(`${target}: orders the method and stays concise`, () => {
      const text = renderPlaybook({ target });
      expect(text).toMatch(/kj rag query/);
      expect(text).toMatch(/test.*first|TDD/i);
      expect(text).toMatch(/kj review --staged/);
      expect(text).toMatch(/security/i);
      expect(text).toMatch(/conventional commits/i);
      // KJC-TSK-0677/0679: in v4 the host agent does the work — the playbook
      // orders the lane COMMAND (narratable practices get narrated, commands
      // get run) and demands the isolation proof.
      expect(text).toMatch(/kj worktree start/);
      expect(text).toMatch(/--git-common-dir/);
      // KJC-TSK-0691 (MG-G): out-of-AC decisions go back to the user.
      expect(text).toMatch(/proposed ADR/);
      expect(text.split("\n").length).toBeLessThanOrEqual(60);
    });
  }

  // KJC-TSK-0684 (issue #1287): card-first points at THE project's board.
  it("external backend names the declared board and drops the HU Board", () => {
    const text = renderPlaybook({ stateBackend: "external", boardName: "Linear" });
    expect(text).toMatch(/tracked card in Linear/);
    expect(text).toMatch(/never create a parallel HU Board/);
    expect(text).not.toMatch(/kj hu add` \/ `kj board/); // hu-board line gone
    expect(text.split("\n").length).toBeLessThanOrEqual(60);
  });

  it("both targets come from the same source (same method lines)", () => {
    const a = renderPlaybook({ target: "claude" });
    const b = renderPlaybook({ target: "codex" });
    expect(a).toBe(b); // single source: identical body, file placement differs
  });
});

describe("installPlaybook", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-pb-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("creates CLAUDE.md and AGENTS.md with the managed block (legacy target both)", async () => {
    const res = await installPlaybook({ projectDir: dir, target: "both" });
    expect(res.files.sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    for (const f of res.files) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      expect(text).toMatch(/kj:managed:playbook/);
      expect(text).toMatch(/kj review --staged/);
    }
  });

  // AB-A (KJC-TSK-0650): any agent can be the brain — gemini gets GEMINI.md
  // and "all" (the new default) covers every host from the single source.
  it("target gemini writes GEMINI.md", async () => {
    const res = await installPlaybook({ projectDir: dir, target: "gemini" });
    expect(res.files).toEqual(["GEMINI.md"]);
    expect(fs.readFileSync(path.join(dir, "GEMINI.md"), "utf8")).toMatch(/kj:managed:playbook/);
  });

  it("target all writes the three host files", async () => {
    const res = await installPlaybook({ projectDir: dir, target: "all" });
    expect(res.files.sort()).toEqual(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
  });

  it("preserves user content and is idempotent", async () => {
    const userContent = "# My project rules\n\nNever touch this line.\n";
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), userContent);
    await installPlaybook({ projectDir: dir, target: "claude" });
    const once = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    expect(once).toContain("Never touch this line.");
    await installPlaybook({ projectDir: dir, target: "claude" });
    const twice = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    expect(twice).toBe(once); // second run: unchanged
    expect(twice.match(/kj:managed:playbook/g).length).toBe(once.match(/kj:managed:playbook/g).length);
  });

  it("respects --target claude (no AGENTS.md written)", async () => {
    const res = await installPlaybook({ projectDir: dir, target: "claude" });
    expect(res.files).toEqual(["CLAUDE.md"]);
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
  });

  it("rejects an unknown target", async () => {
    await expect(installPlaybook({ projectDir: dir, target: "cursor" }))
      .rejects.toThrow(new RegExp(PLAYBOOK_TARGETS.join("|")));
  });
});
