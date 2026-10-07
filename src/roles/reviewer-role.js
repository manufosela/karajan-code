import { createHash } from "node:crypto";

import { AgentRole } from "./agent-role.js";
import { buildRtkInstructions } from "../prompts/rtk-snippet.js";
import { extractFirstJson } from "../utils/json-extract.js";
import { reportUnparseableVerdict } from "../review/unparseable-verdict.js";
import { section, buildPromptLayout, joinLayout, STABLE, VOLATILE } from "../prompts/prompt-layout.js";
import { clipDiff } from "../prompts/diff-clip.js";
import { buildSplitSignal } from "../prompts/split-signal.js";
import { isMutationReviewEnabled, buildReviewerMutationSignal } from "../mutate/reviewer-signal.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on reviewing the code."
].join(" ");

export class ReviewerRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "reviewer" });
  }

  get agentMethod() { return "reviewTask"; }

  extractInput(input) {
    if (typeof input === "string") return { task: input, diff: "", reviewRules: null, onOutput: null };
    return {
      task: input?.task || this.context?.task || "",
      diff: input?.diff || "",
      reviewRules: input?.reviewRules || null,
      onOutput: input?.onOutput || null
    };
  }

  // Φ1-E (KJC-PCS-0057): stable block (preamble, instructions, mode,
  // schema, contexts, rtk, review rules) first; task + diff — different
  // on every review — last. The buckets ride along so ClaudeAgent can
  // ship the stable block via --append-system-prompt (Φ1-D).
  async buildPrompt({ task, diff, reviewRules }) {
    // Opt-in (KJ_REVIEW_MUTATION): null when off/clean → prompt stays identical.
    const mutationSignal = await buildReviewerMutationSignal({
      enabled: isMutationReviewEnabled(),
      projectDir: this.config?.projectDir,
    });
    // KJC-BUG-0134: a clip is declared as kj's own, outside the diff body.
    const { body: clippedDiff, note: clipNote } = clipDiff(diff || "");
    // KJC-BUG-0138: moved-lines correlation, computed on the FULL diff.
    const splitSignal = buildSplitSignal(diff || "");
    const layout = buildPromptLayout([
      section(SUBAGENT_PREAMBLE, STABLE),
      section(this.instructions, STABLE),
      section(`You are a code reviewer in ${this.config?.review_mode || "standard"} mode.`, STABLE),
      section("Return only one valid JSON object and nothing else.", STABLE),
      section("JSON schema:", STABLE),
      section('{"approved":boolean,"blocking_issues":[{"id":string,"severity":"critical|high|medium|low","file":string,"line":number,"description":string,"suggested_fix":string}],"non_blocking_suggestions":[string],"summary":string,"confidence":number}', STABLE),
      section(this.config?.productContext ? `## Product Context\n${this.config.productContext}` : null, STABLE),
      section(this.config?.domainContext ? `## Domain Context\n${this.config.domainContext}` : null, STABLE),
      section(buildRtkInstructions({ rtkAvailable: Boolean(this.config?.rtk?.available) }), STABLE),
      section(reviewRules ? `Review rules:\n${reviewRules}` : null, STABLE),
      section(`Task context:\n${task}`, VOLATILE),
      section(`Git diff:\n${clippedDiff}`, VOLATILE),
      section(clipNote, VOLATILE),
      section(splitSignal, VOLATILE),
      section(mutationSignal, VOLATILE),
    ]);
    return { prompt: joinLayout(layout), stablePrompt: layout.stable, volatilePrompt: layout.volatile };
  }

  parseOutput(raw) {
    const parsed = extractFirstJson(raw);
    if (!parsed) throw new Error("Failed to parse reviewer output: no JSON found");
    // KJC-BUG-0284 (#1982): a reviewer wrapped its verdict in the role envelope
    // {ok, result: {approved…}, summary}; the envelope is not the verdict.
    const verdict = typeof parsed.approved !== "boolean" && typeof parsed.result?.approved === "boolean"
      ? { ...parsed.result, summary: parsed.result.summary ?? parsed.summary }
      : parsed;
    if (typeof verdict.approved !== "boolean") throw new Error("Failed to parse reviewer output: no boolean approved");
    return verdict;
  }

  buildSuccessResult(parsed, provider, agentResult) {
    return {
      ...agentResult,
      approved: parsed.approved,
      blocking_issues: parsed.blocking_issues || [],
      non_blocking_suggestions: parsed.non_blocking_suggestions || [],
      confidence: parsed.confidence ?? null,
      raw_summary: parsed.summary || ""
    };
  }

  buildSummary(parsed) {
    const blockingIssues = parsed.blocking_issues || [];
    return parsed.approved
      ? `Approved: ${parsed.summary || "no issues found"}`
      : `Rejected: ${blockingIssues.length} blocking issue(s) — ${parsed.summary || ""}`;
  }

  // KJC-BUG-0284 (#1982): an unreadable answer is the reviewer's failure, not
  // the coder's. Returned as ok=false so the retry and the fallback reviewer
  // engage (reviewer-fallback.js); the raw answer is saved for inspection.
  // Before, it came back as a PARSE_ERROR rejection: the coder read it as a
  // defect of its code and one run went in circles for twenty minutes.
  async handleParseError(err, agentResult, provider) {
    const output = agentResult?.output;
    const hash = createHash("sha256").update(String(output ?? "")).digest("hex").slice(0, 12);
    const error = await reportUnparseableVerdict({ projectDir: this.config?.projectDir ?? process.cwd(), reviewer: provider, output, hash });
    return {
      ok: false,
      result: { ...agentResult, error: `${err.message}\n${error}`, provider },
      summary: `Reviewer output parse error: ${err.message}`,
      usage: agentResult?.usage
    };
  }
}
