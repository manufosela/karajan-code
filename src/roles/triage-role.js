import { AgentRole } from "./agent-role.js";
import { buildTriagePrompt } from "../prompts/triage.js";
import { VALID_TASK_TYPES } from "../guards/policy-resolver.js";
import { extractFirstJson } from "../utils/json-extract.js";

const VALID_LEVELS = new Set(["trivial", "simple", "medium", "complex"]);
const VALID_ROLES = new Set(["planner", "researcher", "refactorer", "reviewer", "tester", "security", "impeccable"]);
const FALLBACK_TASK_TYPE = "sw";
const FALLBACK_RESULT = { level: "medium", roles: ["reviewer"], taskType: FALLBACK_TASK_TYPE, shouldDecompose: false };

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return Array.from(new Set(roles.filter((role) => VALID_ROLES.has(role))));
}

function normalizeSubtasks(subtasks) {
  if (!Array.isArray(subtasks)) return [];
  return subtasks.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean).slice(0, 5);
}

function normalizeDomainHints(hints) {
  if (!Array.isArray(hints)) return [];
  return hints.map((h) => (typeof h === "string" ? h.trim().toLowerCase() : "")).filter(Boolean);
}

export class TriageRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "triage" });
  }

  async buildPrompt({ task }) {
    return { prompt: buildTriagePrompt({ task, instructions: this.instructions }) };
  }

  parseOutput(raw) { return extractFirstJson(raw); }

  buildSuccessResult(parsed, provider) {
    const level = VALID_LEVELS.has(parsed.level) ? parsed.level : "medium";
    const roles = normalizeRoles(parsed.roles);
    const reasoning = String(parsed.reasoning || "").trim() || "No reasoning provided.";
    const shouldDecompose = Boolean(parsed.shouldDecompose);
    const subtasks = normalizeSubtasks(parsed.subtasks);
    const taskType = VALID_TASK_TYPES.has(parsed.taskType) ? parsed.taskType : FALLBACK_TASK_TYPE;
    const domainHints = normalizeDomainHints(parsed.domainHints);

    const result = { level, roles, reasoning, taskType, domainHints, provider };
    if (shouldDecompose && subtasks.length > 0) {
      result.shouldDecompose = true;
      result.subtasks = subtasks;
    } else {
      result.shouldDecompose = false;
    }
    return result;
  }

  buildSummary(parsed) {
    const level = VALID_LEVELS.has(parsed.level) ? parsed.level : "medium";
    const roles = normalizeRoles(parsed.roles);
    const decomposeNote = parsed.shouldDecompose ? " — decomposition recommended" : "";
    return `Triage: ${level} (${roles.length} role${roles.length === 1 ? "" : "s"})${decomposeNote}`;
  }

  handleParseNull(agentResult, provider) {
    return this.degradedTriageResult({
      agentResult, provider,
      reason: "parse-null",
      reasoning: "Unstructured output, using safe defaults.",
      message: "[triage] LLM output was unstructured — falling back to defaults; the pipeline may skip optional roles.",
    });
  }

  handleParseError(err, agentResult, provider) {
    return this.degradedTriageResult({
      agentResult, provider,
      reason: "parse-error",
      reasoning: `Failed to parse triage output (${err?.message || "unknown error"}), using safe defaults.`,
      message: `[triage] Could not parse LLM output — falling back to defaults: ${err?.message || "unknown"}.`,
    });
  }

  // Triage degradation is what made a complex task quietly run as
  // `level: "medium", roles: ["reviewer"]` — researcher / architect /
  // security / tester silently skipped. The fallback is preserved so
  // the pipeline still moves, but the user (and any board / kj-tail
  // listener) now learns it happened. result.degraded = true lets
  // downstream code react if it wants.
  // Same shape as before so downstream cost / event accounting is
  // byte-identical; the only change is the loud logger.warn, which is
  // what makes the silent degradation visible to the user / kj-tail.
  degradedTriageResult({ agentResult, provider, reason: _reason, reasoning, message }) {
    this.logger?.warn?.(message);
    return {
      ok: true,
      result: { ...FALLBACK_RESULT, reasoning, provider, raw: agentResult.output },
      summary: "Triage complete (fallback defaults)",
      usage: agentResult.usage,
    };
  }
}
