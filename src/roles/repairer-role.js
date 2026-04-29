/**
 * RepairerRole — repairs broken acceptance tests at runtime.
 *
 * The Brain calls this when an HU's acceptance test has failed N
 * consecutive iterations with the same error signature, signalling
 * that the test ITSELF may be the bug (not the implementation).
 * Originated from the 2026-04-29 incident where the planner emitted
 * a syntactically-broken jq query in HU 002's acceptance_tests; the
 * coder iterated 3× trying to make an irreparable test pass; HU 002
 * → failed → 7 dependents blocked.
 *
 * The role takes the failing test + its error output + HU intent and
 * returns either a corrected test (`verdict: "fixable"` with
 * `fixed_test`) or an escalation (`verdict: "unfixable"` with reason).
 *
 * Behaviour notes:
 *  - The role MUST NOT soften assertions to make them pass — the test
 *    defines the contract; this role's job is to make the test ASK
 *    its question correctly, not weakly.
 *  - The role MUST NOT rewrite a test to pass against the current
 *    code. Code is measured against the test, not the other way.
 *  - One bug per repair. If the test is layered with problems, return
 *    the most blocking fix first; subsequent invocations handle the
 *    rest.
 */

import { AgentRole } from "./agent-role.js";
import { extractFirstJson } from "../utils/json-extract.js";
import { loadAvailableSkills, buildSkillSection } from "../skills/skill-loader.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on diagnosing and (if possible) repairing a single broken acceptance test.",
].join(" ");

export class RepairerRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "repairer" });
  }

  resolveProvider() {
    // Default to the same provider family the coder uses — keeps
    // the repair attempt cheap and consistent. Per-role override
    // works as for every other role.
    return this.config?.roles?.repairer?.provider
      || this.config?.roles?.coder?.provider
      || this.config?.coder
      || "claude";
  }

  /**
   * Inputs:
   *   - failingTest: the test object (`{ type, content }` or string).
   *   - errorOutput: stdout+stderr from the last test run (truncated to
   *     ~2KB to keep the prompt small).
   *   - huTitle, huScope: intent context.
   *   - siblingTests: the HU's other acceptance_tests (for consistency).
   *   - iteration: how many coder iterations have already failed on this.
   */
  extractInput(input) {
    if (typeof input === "string") {
      return {
        failingTest: input, errorOutput: "", huTitle: "", huScope: "",
        siblingTests: [], iteration: 0, onOutput: null,
      };
    }
    return {
      failingTest: input?.failingTest ?? null,
      errorOutput: input?.errorOutput ?? "",
      huTitle: input?.huTitle ?? "",
      huScope: input?.huScope ?? "",
      siblingTests: Array.isArray(input?.siblingTests) ? input.siblingTests : [],
      iteration: Number.isFinite(input?.iteration) ? input.iteration : 0,
      onOutput: input?.onOutput ?? null,
    };
  }

  async buildPrompt({ failingTest, errorOutput, huTitle, huScope, siblingTests, iteration }) {
    const sections = [SUBAGENT_PREAMBLE];
    if (this.instructions) sections.push(this.instructions);

    const testContent = (failingTest && typeof failingTest === "object")
      ? failingTest.content
      : String(failingTest || "");
    const testType = (failingTest && typeof failingTest === "object" && failingTest.type)
      ? failingTest.type
      : "shell";

    sections.push(
      "You are repairing a broken acceptance test. The coder has failed to satisfy it across multiple iterations,",
      "and the Brain suspects the test ITSELF is the bug — not the implementation.",
      "",
      "## HU intent",
      `Title: ${huTitle || "(unknown)"}`,
      `Scope: ${huScope || "(unknown)"}`,
      "",
      `## Failing test (type: ${testType}, after ${iteration} iteration(s))`,
      "```",
      testContent,
      "```",
      "",
      "## Last error output",
      "```",
      String(errorOutput || "").slice(0, 2048),
      "```",
    );

    if (siblingTests.length > 0) {
      sections.push("## HU's other acceptance tests (for consistency — do NOT modify these)", "```");
      for (const t of siblingTests) {
        const c = typeof t === "object" ? t.content : t;
        sections.push(`- ${c}`);
      }
      sections.push("```");
    }

    sections.push(
      "",
      "## Your job",
      "Decide whether the failing test is **fixable** (you can correct a syntactic / structural bug)",
      "or **unfixable** (test is fundamentally impossible, or the test is correct and the code must change).",
      "",
      "Return ONLY a single valid JSON object:",
      '{"verdict":"fixable"|"unfixable","fixed_test":{"type":"shell"|"gherkin","content":string}|null,"reason":string,"diagnostics":[string]}',
      "",
      "- When verdict=fixable, fixed_test is REQUIRED and reason describes the bug class.",
      "- When verdict=unfixable, fixed_test is null and reason explains why.",
      "- NEVER soften an assertion. NEVER rewrite to pass against current code.",
    );

    const projectDir = this.config?.projectDir || process.cwd();
    const skills = await loadAvailableSkills(projectDir);
    const skillSection = buildSkillSection(skills, {
      provider: this._resolvedProvider || (typeof this.resolveProvider === "function" ? this.resolveProvider() : null),
      role: "repairer",
    });
    if (skillSection) sections.push(skillSection);

    return { prompt: sections.join("\n\n") };
  }

  parseOutput(raw) { return extractFirstJson(raw); }

  isSuccessful(parsed) {
    if (!parsed || typeof parsed !== "object") return false;
    if (parsed.verdict === "fixable") {
      // Must produce a complete fixed_test object.
      const ft = parsed.fixed_test;
      return Boolean(ft && typeof ft === "object" && typeof ft.content === "string" && ft.content.trim());
    }
    if (parsed.verdict === "unfixable") {
      // Unfixable is a valid OUTCOME (escalation), not a role failure.
      return Boolean(parsed.reason && String(parsed.reason).trim());
    }
    return false;
  }

  buildSuccessResult(parsed, provider) {
    return {
      verdict: parsed.verdict,
      fixed_test: parsed.fixed_test || null,
      reason: parsed.reason || "",
      diagnostics: Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [],
      provider,
    };
  }

  buildSummary(parsed) {
    if (!parsed) return "Repairer: no parseable output";
    if (parsed.verdict === "fixable") {
      const reason = (parsed.reason || "").slice(0, 120);
      return `Repairer: fixable — ${reason}`;
    }
    if (parsed.verdict === "unfixable") {
      const reason = (parsed.reason || "").slice(0, 120);
      return `Repairer: unfixable — ${reason}`;
    }
    return `Repairer: unexpected verdict "${parsed.verdict}"`;
  }
}
