// KJC-TSK-0963 (MDR-F4, ADR 0017): kj rules review — whoever proposes how it is
// going to be watched is not the one who calls the proposal good. A different AI
// reads it rule by rule, and its verdict is tied to the exact bytes.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rulesReview } from "../../src/commands/rules-review.js";
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

  it("judges only the rules that differ from the installed ones", async () => {
    propose();
    fs.writeFileSync(path.join(dir, ".karajan", "rules.yml"), fs.readFileSync(proposal, "utf8"));
    const agents = answering({ approved: true, blocking_issues: [] });
    await review(agents);
    const { prompt } = agents.mock.results[0].value.reviewTask.mock.calls[0][0];
    expect(prompt).toMatch(/judge ONLY the rules that are new or differ/);
    expect(prompt).toMatch(/No rule changed: approve/);
    expect(prompt).toMatch(/identical to the installed ones/);
    expect(prompt).not.toContain(rule.text); // HU-4032: an unchanged rule is not even sent
    expect((await checkVerdict(dir, fs.readFileSync(proposal, "utf8"))).ok).toBe(true); // still bound to the whole proposal
  });
  it("sends a rule that differs from the installed one", async () => {
    propose();
    fs.writeFileSync(path.join(dir, ".karajan", "rules.yml"), fs.readFileSync(proposal, "utf8").replace("kind: judgment", "kind: out-of-scope"));
    const agents = answering({ approved: true, blocking_issues: [] });
    await review(agents);
    expect(agents.mock.results[0].value.reviewTask.mock.calls[0][0].prompt).toContain(rule.text);
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
