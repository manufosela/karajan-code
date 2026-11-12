// KJC-TSK-0963 (MDR-F4, ADR 0017): kj rules review — whoever proposes how it is
// going to be watched is not the one who calls the proposal good. A different AI
// reads it rule by rule, and its verdict is tied to the exact bytes.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rulesReview, scopeOf } from "../../src/commands/rules-review.js";
import { listRules } from "../../src/rules/inventory.js";
import { checkVerdict } from "../../src/review/verdict-store.js";

let dir, home, rule, proposal;
const propose = (kind = "kind: judgment, when: { tool: Bash }") => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(proposal, `version: 1\nrules:\n  - { id: ${rule.id}, source: CLAUDE.md, text: "${rule.text}", ${kind} }\n`);
};
const answering = (payload) => vi.fn(() => ({ reviewTask: vi.fn(async () => ({ ok: true, output: JSON.stringify(payload) })) }));
const review = (createAgentFn, over = {}) => rulesReview({
  projectDir: dir, home, config: { roles: { reviewer: { provider: "codex" } } },
  deps: { hostAgent: "claude", createAgentFn, detectAgents: async () => [{ name: "codex", available: true }], ...over },
});
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-review-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-review-home-"));
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "- Nunca despliegues sin permiso.\n");
  [rule] = listRules(dir, { home });
  proposal = path.join(dir, ".karajan", "rules.proposed.yml");
});
afterEach(() => { for (const d of [dir, home]) fs.rmSync(d, { recursive: true, force: true }); });

describe("kj rules review", () => {
  it("a different AI reads the proposal and its verdict is tied to those exact bytes", async () => {
    propose();
    const agents = answering({ approved: true, blocking_issues: [], summary: "fiel al texto" });
    const res = await review(agents);
    expect(res.code).toBe(0);
    expect(agents).toHaveBeenCalledWith("codex", expect.anything(), undefined);
    const { prompt } = agents.mock.results[0].value.reviewTask.mock.calls[0][0];
    expect(prompt).toContain(rule.text);
    expect(prompt).toMatch(/weaker than its text/);
    expect(await checkVerdict(dir, fs.readFileSync(proposal, "utf8"))).toMatchObject({ ok: true, verdict: { reviewer: "codex" } });
    fs.appendFileSync(proposal, "# touched after the review\n");
    expect((await checkVerdict(dir, fs.readFileSync(proposal, "utf8"))).ok).toBe(false);
  });

  // HU-4033 (issue 4025): the reviewer is shown only what the proposal changes.
  describe("scope of the input", () => {
    let A, B, C, D;
    const entry = (r, tool = "Bash", source = "CLAUDE.md") => `  - { id: ${r.id}, source: ${source}, text: "${r.text}", kind: judgment, when: { tool: ${tool} } }\n`;
    const write = (file, entries) => fs.writeFileSync(path.join(dir, ".karajan", file), `version: 1\nrules:\n${entries.join("")}`);
    const run = async () => {
      const agents = answering({ approved: true, blocking_issues: [] });
      const res = await review(agents);
      const call = agents.mock.results[0]?.value.reviewTask.mock.calls[0]?.[0];
      return { res, prompt: call?.prompt, agents };
    };
    beforeEach(() => {
      fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
      // delta is longer than a YAML line: the reviewer still reads its text whole, on one line.
      const delta = "- Nunca delta en una rama compartida sin avisar antes a todo el equipo que trabaja en ella.\n";
      fs.writeFileSync(path.join(dir, "CLAUDE.md"), `- Nunca alpha.\n- Nunca bravo.\n- Nunca charlie.\n${delta}`);
      [A, B, C, D] = listRules(dir, { home });
    });

    it("changed and new rules are shown, an identical one is not; a removed one is shown whole", async () => {
      write("rules.yml", [entry(A), entry(B), entry(D, "Write")]);
      write("rules.proposed.yml", [entry(A, "Edit"), entry(B), entry(C)]);
      const { prompt } = await run();
      expect(prompt).toContain(A.text);
      expect(prompt).toContain(C.text);
      expect(prompt).not.toContain(B.text);
      expect(prompt).toMatch(/^removed_rules:$/m);
      const removed = prompt.slice(prompt.search(/^removed_rules:$/m));
      expect(removed).toContain(D.text);
      expect(removed).toContain("tool: Write");
      expect(removed).not.toContain(C.text);
      expect(prompt).toMatch(/weakening/);
    });

    it("with no installed rules every rule is shown", async () => {
      write("rules.proposed.yml", [entry(A), entry(B)]);
      const { prompt } = await run();
      expect(prompt).toContain(A.text);
      expect(prompt).toContain(B.text);
    });

    it("a proposal identical to the installed rules is still reviewed, and the reviewer sees no rule", async () => {
      write("rules.yml", [entry(A)]);
      write("rules.proposed.yml", [entry(A)]);
      const { res, prompt, agents } = await run();
      expect(agents).toHaveBeenCalled();
      expect(res.code).toBe(0);
      expect(prompt).not.toContain(A.text);
      expect(prompt).toMatch(/^rules: \[\]$/m);
      expect(prompt).toMatch(/^removed_rules: \[\]$/m);
    });

    // The source decides whether a rule is installed in the versioned file or the local one.
    it("a rule whose only change is its source is shown", async () => {
      write("rules.yml", [entry(A, "Bash", "CLAUDE.local.md"), entry(B)]);
      write("rules.proposed.yml", [entry(A), entry(B)]);
      const { prompt } = await run();
      expect(prompt).toContain(A.text);
      expect(prompt).not.toContain(B.text);
      expect(prompt).toMatch(/^removed_rules: \[\]$/m);
    });

    it("a removed rule comes back whole, as it is installed", () => {
      const kept = { id: "r1", kind: "judgment", text: "t1", source: "A.md" };
      const gone = { id: "r2", kind: "judgment", text: "t2", when: { tool: "Bash" }, source: "B.md" };
      expect(scopeOf([kept], [kept, gone])).toEqual({ changed: [], removed: [gone] });
    });

    it("the verdict stays bound to the whole proposal file", async () => {
      write("rules.yml", [entry(A), entry(B)]);
      write("rules.proposed.yml", [entry(A, "Edit"), entry(B)]);
      await run();
      expect((await checkVerdict(dir, fs.readFileSync(proposal, "utf8"))).ok).toBe(true);
    });
  });

  it("a rejection names the rules the reviewer found weak", async () => {
    propose();
    const res = await review(answering({ approved: false, blocking_issues: [{ description: `${rule.id}: a tool call breaks it, judgment is too weak` }] }));
    expect(res.code).toBe(1);
    expect(res.lines.join("\n")).toMatch(new RegExp(`REJECTED by codex[\\s\\S]*${rule.id}`));
    expect((await checkVerdict(dir, fs.readFileSync(proposal, "utf8"))).ok).toBe(false);
  });

  it("a proposal that does not hold is not sent to review, and the host never reviews itself", async () => {
    propose("kind: deterministic, when: { tool: Bash }"); // no examples
    const agents = answering({ approved: true });
    expect(await review(agents)).toMatchObject({ code: 1, lines: [expect.stringMatching(/needs examples/)] });
    expect(agents).not.toHaveBeenCalled();
    propose();
    const onlyTheHost = { hostAgent: "claude", createAgentFn: agents, detectAgents: async () => [{ name: "claude", available: true }] };
    await expect(rulesReview({ projectDir: dir, home, config: {}, deps: onlyTheHost })).rejects.toThrow(/agent other than the host/);
    expect(agents).not.toHaveBeenCalled();
  });

  // KJC-TSK-1408: codex without quota and copilot failing left no reviewer; kj review takes
  // --reviewer, and so does kj rules review (withConfig applies it to the config).
  it("kj rules review takes --reviewer like kj review", async () => {
    const { Command } = await import("commander");
    const { registerMeta } = await import("../../src/cli/register-meta.js");
    const program = new Command();
    registerMeta(program, { pkgVersion: "0.0.0-test" });
    const reviewCmd = program.commands.find((c) => c.name() === "rules").commands.find((c) => c.name() === "review");
    expect(reviewCmd.options.map((o) => o.long)).toContain("--reviewer");
  });
});
