import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";
import { isDevToolsMcpAvailable, ensureWebPerfSkills } from "../webperf/devtools-detect.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on auditing frontend/UI code for design quality."
].join(" ");

function resolveProvider(config) {
  return (
    config?.roles?.impeccable?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function buildPrompt({ task, diff, instructions }) {
  const sections = [SUBAGENT_PREAMBLE];

  if (instructions) {
    sections.push(instructions);
  }

  sections.push(
    `## Task\n${task}`
  );

  if (diff) {
    sections.push(`## Git diff to audit\n${diff}`);
  }

  return sections.join("\n\n");
}

function parseImpeccableOutput(raw) {
  const text = raw?.trim() || "";
  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

function buildSummary(parsed) {
  const verdict = parsed.verdict || "APPROVED";
  const found = parsed.issuesFound || 0;
  const fixed = parsed.issuesFixed || 0;

  if (verdict === "APPROVED" || found === 0) {
    return `Verdict: APPROVED; No frontend design issues found`;
  }

  const cats = parsed.categories || {};
  const parts = Object.entries(cats)
    .filter(([, count]) => count > 0)
    .map(([cat, count]) => `${count} ${cat}`);

  return `Verdict: ${verdict}; ${found} issue(s) found, ${fixed} fixed (${parts.join(", ")})`;
}

export class ImpeccableRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null, mode = "audit" }) {
    const roleName = mode === "refactoring" ? "impeccable-design" : "impeccable";
    super({ name: roleName, config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
    this.mode = mode;
  }

  async execute(input) {
    const { task, diff, projectDir } = typeof input === "string"
      ? { task: input, diff: null, projectDir: null }
      : { task: input?.task || this.context?.task || "", diff: input?.diff || null, projectDir: input?.projectDir || null };

    // Auto-install WebPerf skills when DevTools MCP is configured
    if (isDevToolsMcpAvailable(this.config)) {
      const dir = projectDir || process.cwd();
      try {
        const webperfResult = await ensureWebPerfSkills(dir, this.logger);
        if (webperfResult.installed.length > 0) {
          this.logger?.info?.(`WebPerf skills installed: ${webperfResult.installed.join(", ")}`);
        }
      } catch (err) {
        this.logger?.warn?.(`WebPerf skill installation failed: ${err.message}`);
      }
    } else {
      this.logger?.info?.("Chrome DevTools MCP not configured — skipping WebPerf skills");
    }

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const webperfNote = isDevToolsMcpAvailable(this.config)
      ? "\n\nNote: WebPerf domain skills are available. Use them for Core Web Vitals analysis if the audit involves frontend performance."
      : "";
    const prompt = buildPrompt({ task, diff, instructions: this.instructions }) + webperfNote;
    const result = await agent.runTask({ prompt, role: "impeccable" });

    if (!result.ok) {
      return {
        ok: false,
        result: {
          error: result.error || result.output || "Impeccable audit failed",
          provider
        },
        summary: `Impeccable audit failed: ${result.error || "unknown error"}`
      };
    }

    try {
      const parsed = parseImpeccableOutput(result.output);
      if (!parsed) {
        return {
          ok: false,
          result: { error: "Failed to parse impeccable output: no JSON found", provider },
          summary: "Impeccable output parse error: no JSON found"
        };
      }

      const verdict = parsed.verdict || (parsed.issuesFound > 0 ? "IMPROVED" : "APPROVED");
      const ok = verdict === "APPROVED" || verdict === "IMPROVED";

      return {
        ok,
        result: {
          verdict,
          issuesFound: parsed.issuesFound || 0,
          issuesFixed: parsed.issuesFixed || 0,
          categories: parsed.categories || {},
          changes: parsed.changes || [],
          provider
        },
        summary: buildSummary({ ...parsed, verdict })
      };
    } catch (err) {
      return {
        ok: false,
        result: { error: `Failed to parse impeccable output: ${err.message}`, provider },
        summary: `Impeccable output parse error: ${err.message}`
      };
    }
  }
}
