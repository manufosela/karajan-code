import { AgentRole } from "./agent-role.js";
import { isDevToolsMcpAvailable, ensureWebPerfSkills } from "../webperf/devtools-detect.js";
import { extractFirstJson } from "../utils/json-extract.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on auditing frontend/UI code for design quality."
].join(" ");

function buildSummary(parsed) {
  const verdict = parsed.verdict || "APPROVED";
  const found = parsed.issuesFound || 0;
  const fixed = parsed.issuesFixed || 0;
  if (verdict === "APPROVED" || found === 0) return "Verdict: APPROVED; No frontend design issues found";

  const cats = parsed.categories || {};
  const parts = Object.entries(cats).filter(([, count]) => count > 0).map(([cat, count]) => `${count} ${cat}`);
  return `Verdict: ${verdict}; ${found} issue(s) found, ${fixed} fixed (${parts.join(", ")})`;
}

export class ImpeccableRole extends AgentRole {
  constructor(opts) {
    const mode = opts.mode || "audit";
    const roleName = mode === "refactoring" ? "impeccable-design" : "impeccable";
    super({ ...opts, name: roleName });
    this.mode = mode;
  }

  resolveProvider() {
    return this.config?.roles?.impeccable?.provider || this.config?.roles?.coder?.provider || "claude";
  }

  async execute(input) {
    const task = typeof input === "string" ? input : input?.task || this.context?.task || "";
    const diff = typeof input === "object" ? input?.diff || null : null;
    const projectDir = typeof input === "object" ? input?.projectDir || null : null;

    // Auto-install WebPerf skills when DevTools MCP is configured
    if (isDevToolsMcpAvailable(this.config)) {
      const dir = projectDir || process.cwd();
      try {
        const webperfResult = await ensureWebPerfSkills(dir, this.logger);
        if (webperfResult.installed.length > 0) this.logger?.info?.(`WebPerf skills installed: ${webperfResult.installed.join(", ")}`);
      } catch (err) {
        this.logger?.warn?.(`WebPerf skill installation failed: ${err.message}`);
      }
    } else {
      this.logger?.debug?.("Chrome DevTools MCP not configured — WebPerf skills skipped");
    }

    const provider = this.resolveProvider();
    const agent = this.createAgentInstance(provider);

    const sections = [SUBAGENT_PREAMBLE];
    if (this.instructions) sections.push(this.instructions);
    sections.push(`## Task\n${task}`);
    if (diff) sections.push(`## Git diff to audit\n${diff}`);
    if (isDevToolsMcpAvailable(this.config)) {
      sections.push("\nNote: WebPerf domain skills are available. Use them for Core Web Vitals analysis if the audit involves frontend performance.");
    }

    const result = await agent.runTask({ prompt: sections.join("\n\n"), role: "impeccable" });

    if (!result.ok) {
      return { ok: false, result: { error: result.error || result.output || "Impeccable audit failed", provider }, summary: `Impeccable audit failed: ${result.error || "unknown error"}` };
    }

    try {
      const parsed = extractFirstJson(result.output);
      if (!parsed) {
        return { ok: false, result: { error: "Failed to parse impeccable output: no JSON found", provider }, summary: "Impeccable output parse error: no JSON found" };
      }

      const verdict = parsed.verdict || (parsed.issuesFound > 0 ? "IMPROVED" : "APPROVED");
      return {
        ok: verdict === "APPROVED" || verdict === "IMPROVED",
        result: { verdict, issuesFound: parsed.issuesFound || 0, issuesFixed: parsed.issuesFixed || 0, categories: parsed.categories || {}, changes: parsed.changes || [], provider },
        summary: buildSummary({ ...parsed, verdict })
      };
    } catch (err) {
      return { ok: false, result: { error: `Failed to parse impeccable output: ${err.message}`, provider }, summary: `Impeccable output parse error: ${err.message}` };
    }
  }
}
