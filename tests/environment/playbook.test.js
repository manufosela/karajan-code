// ENV-A1 (KJC-TSK-0639): one source renders the Karajan method for every
// host agent. The playbook is agent CONTEXT — the tests cap its size so it
// stays signal, and pin the invariants: never touch user content outside
// the managed block, idempotent re-install, method steps present.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderPlaybook, installPlaybook, PLAYBOOK_TARGETS } from "../../src/environment/playbook.js";

describe("renderPlaybook × live values", () => {
  // KJC-TSK-1392 (ADR 0045): the agent reads the PR size its project really has.
  it("states the resolved PR size, not a hardcoded one", () => {
    const text = renderPlaybook({ config: { method_gates: { pr_size_warn: 250, pr_size_max: 400 } } });
    expect(text).toMatch(/~250 net lines of code is the ideal, up to 400 is\s+allowed without asking, above 400 partition/);
    expect(text).toMatch(/atomic PR \(~250 net lines of code/);
    expect(renderPlaybook({})).toMatch(/~150 net lines of code is the ideal, up to 200/);
  });
});

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
      // KJC-TSK-0695: sensitive-surface tasks self-invoke the security pass.
      expect(text).toMatch(/kj audit --security/);
      // KJC-TSK-0696: the alternatives clause — legacy-following is a choice.
      expect(text).toMatch(/as if the\s+codebase didn'?t exist/i);
      // KJC-TSK-0706: the outbound privacy boundary before publishing.
      expect(text).toMatch(/kj privacy scan/);
      // KJC-TSK-0711: the RAG is a native MCP tool, not just a Bash command.
      expect(text).toMatch(/kj_rag_query/);
      // KJC-BUG-0312 (#2059): the line budget is for code; what the pr-size gate exempts is named.
      expect(text).toMatch(/150 net lines of code[\s\S]*human\s+docs, lockfiles, snapshots and dist\/ do not count, AI-rule files do/);
      // KJC-TSK-1378 (#3206): simplify after green and before the review the verdict binds to.
      expect(text).toMatch(/simplify[\s\S]*no test weakened[\s\S]*BEFORE the\s+review/i);
      // HU-3533 (KJC-TSK-1445): the agent plans each card's tier and kj code writes it, as kj run did.
      expect(text).toMatch(/--tier trivial\|standard\|deep/);
      expect(text).toMatch(/kj code --card <id> --brief[\s\S]*--retry/);
      expect(text.split("\n").length).toBeLessThanOrEqual(60);
    });
  }

  // KJC-BUG-0305 (issue #2042): the HU Board stays kj's board; the external
  // tracker gets a replica of each card, linked with --ref.
  it("external backend keeps the HU Board and asks for the linked replica", () => {
    const text = renderPlaybook({ stateBackend: "external", boardName: "Linear" });
    expect(text).toMatch(/HU Board/);
    expect(text).toMatch(/kj hu add[\s\S]*--ref/);
    expect(text).toMatch(/replica in Linear/);
    expect(text).not.toMatch(/never create a parallel HU Board/);
    expect(text.split("\n").length).toBeLessThanOrEqual(60);
  });
  // KJC-TSK-1469 (HU-3636): kj's human acts are typed by the user, never scripted.
  it("states that kj's human acts are typed by hand, never run from a script", () => {
    const text = renderPlaybook({});
    expect(text).toMatch(/kj's human acts \(`kj harden --commit`, `kj rules approve`, `kj identity enroll-phone`\) are typed\s+by your user in their own terminal/);
    expect(text).toMatch(/never put them in a script or run them with bash; kj\s+refuses anything an agent launched/);
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

  // KJC-TSK-1504: AGENTS.md is the one file of agent rules for every host; the
  // old targets stay as aliases so no script that passes them breaks.
  for (const target of PLAYBOOK_TARGETS) {
    it(`target ${target} writes only AGENTS.md`, async () => {
      const res = await installPlaybook({ projectDir: dir, target });
      expect(res.files).toEqual(["AGENTS.md"]);
      const text = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
      expect(text).toMatch(/kj:managed:playbook/);
      expect(text).toMatch(/kj review --staged/);
      expect(fs.existsSync(path.join(dir, "CLAUDE.md"))).toBe(false);
      expect(fs.existsSync(path.join(dir, "GEMINI.md"))).toBe(false);
    });
  }

  it("moves an old CLAUDE.md and GEMINI.md into AGENTS.md, keeping what a person wrote", async () => {
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# My project rules\n\nNever touch this line.\n");
    fs.writeFileSync(path.join(dir, "GEMINI.md"), "");
    const res = await installPlaybook({ projectDir: dir });
    expect(res.migrated).toEqual([{ file: "CLAUDE.md", moved: 2 }, { file: "GEMINI.md", moved: 0 }]);
    expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toMatch(/^# My project rules\n\nNever touch this line\.\n<!-- >>> kj:managed:playbook/);
    expect(fs.existsSync(path.join(dir, "CLAUDE.md"))).toBe(false);
  });

  it("preserves user content and is idempotent", async () => {
    const userContent = "# My project rules\n\nNever touch this line.\n";
    fs.writeFileSync(path.join(dir, "AGENTS.md"), userContent);
    await installPlaybook({ projectDir: dir });
    const once = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(once).toContain("Never touch this line.");
    await installPlaybook({ projectDir: dir });
    const twice = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(twice).toBe(once); // second run: unchanged
    expect(twice.match(/kj:managed:playbook/g).length).toBe(once.match(/kj:managed:playbook/g).length);
  });

  it("rejects an unknown target", async () => {
    await expect(installPlaybook({ projectDir: dir, target: "cursor" }))
      .rejects.toThrow(new RegExp(PLAYBOOK_TARGETS.join("|")));
  });
});
