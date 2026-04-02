/**
 * Shared helpers used by MCP handler sub-modules.
 * Extracted from server-handlers.js to break circular import chains
 * (server-handlers.js ↔ handlers/*.js).
 *
 * Sub-handlers MUST import from here, NOT from server-handlers.js.
 * server-handlers.js re-exports everything for external consumers.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { loadConfig, applyRunOverrides, validateConfig } from "../config.js";
import { currentBranch } from "../utils/git.js";
import { buildProgressNotifier } from "./progress.js";
import { compressResponse, compactStringify } from "./response-compressor.js";
import { classifyError } from "./error-classifiers.js";

export { classifyError } from "./error-classifiers.js";

/**
 * Resolve the user's project directory.
 * Priority: 1) explicit projectDir param, 2) MCP roots, 3) error with instructions.
 */
export async function resolveProjectDir(server, explicitProjectDir) {
  if (explicitProjectDir) return explicitProjectDir;

  try {
    const { roots } = await server.listRoots();
    if (roots?.length > 0) {
      const uri = roots[0].uri;
      if (uri.startsWith("file://")) return new URL(uri).pathname;
      return uri;
    }
  } catch { /* client may not support roots */ }

  const cwd = process.cwd();
  try {
    const hasGit = await fs.access(`${cwd}/.git`).then(() => true).catch(() => false);
    const hasPkg = await fs.access(`${cwd}/package.json`).then(() => true).catch(() => false);
    if (hasGit || hasPkg) return cwd;
  } catch { /* ignore */ }

  throw new Error(
    `Cannot determine project directory. The MCP server is running from "${cwd}" which does not appear to be your project. ` +
    `Fix: pass the "projectDir" parameter with the absolute path to your project (e.g., projectDir: "/home/user/my-project"), ` +
    `or run "kj init" inside your project directory.`
  );
}

export function asObject(value) {
  if (value && typeof value === "object") return value;
  return {};
}

export function responseText(payload) {
  const compressed = compressResponse(payload);
  return {
    content: [{ type: "text", text: compactStringify(compressed) }]
  };
}

export function failPayload(message, details = {}) {
  return {
    ok: false,
    error: message,
    ...details
  };
}

export async function assertNotOnBaseBranch(config, { allowForRun = false } = {}) {
  const baseBranch = config?.base_branch || "main";
  let branch;
  try {
    branch = await currentBranch();
  } catch {
    return; // No git repo or no commits — bootstrap/orchestrator will handle it
  }
  if (branch === baseBranch) {
    // kj_run creates its own branch via prepareGitAutomation — allow it
    if (allowForRun) return;
    throw new Error(
      `You are on the base branch '${baseBranch}'. Karajan needs a feature branch to compute the diff for review. ` +
      `Create a new branch first (e.g. 'git checkout -b feat/<task-description>') and then run this command again. ` +
      `Do NOT run kj_code directly — create the branch first so the full pipeline (code + review) works correctly.`
    );
  }
}

export function enrichedFailPayload(error, toolName) {
  const msg = error?.message || String(error);
  const { category, suggestion } = classifyError(error);
  const payload = {
    ok: false,
    error: msg,
    tool: toolName,
    category
  };
  if (suggestion) payload.suggestion = suggestion;
  return payload;
}

export async function buildConfig(options, commandName = "run") {
  const { config } = await loadConfig();
  const merged = applyRunOverrides(config, options || {});
  validateConfig(merged, commandName);
  return merged;
}

/**
 * Parse a structured response from free-text input.
 * Exported for testing.
 * @param {string} raw — user's raw text answer
 * @param {string} type — question type: "multi-select" | "select" | "confirm" | "text"
 * @param {Array<{id: string, label: string}>} [options] — available options (for select types)
 * @returns {string[]|string|boolean|null} parsed response
 */
export function parseStructuredResponse(raw, type, options = []) {
  const trimmed = (raw || "").trim();
  const lower = trimmed.toLowerCase();

  if (type === "confirm") {
    return ["yes", "y", "si", "sí", "1", "true"].includes(lower) ? true : false;
  }

  if (type === "text") {
    return trimmed;
  }

  if (type === "select") {
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      return options[num - 1].id;
    }
    // Try matching by id directly
    const match = options.find(o => o.id.toLowerCase() === lower);
    return match ? match.id : (options[0]?.id || null);
  }

  if (type === "multi-select") {
    if (lower === "all") return options.map(o => o.id);
    if (lower === "none" || lower === "0") return [];

    // Parse comma-separated numbers or ids
    const parts = trimmed.split(/[,;\s]+/).map(p => p.trim()).filter(Boolean);
    const selected = [];

    for (const part of parts) {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= options.length) {
        selected.push(options[num - 1].id);
      } else {
        const match = options.find(o => o.id.toLowerCase() === part.toLowerCase());
        if (match) selected.push(match.id);
      }
    }

    return selected;
  }

  return trimmed || null;
}

/**
 * Format a structured question into a text message for elicitInput.
 * @param {Object} question
 * @returns {string}
 */
function formatStructuredQuestion(question) {
  const lines = [question.message, ""];

  if (question.options?.length) {
    for (let i = 0; i < question.options.length; i++) {
      const opt = question.options[i];
      const marker = opt.default ? "*" : " ";
      lines.push(`  ${i + 1}.${marker} ${opt.label}`);
    }
    lines.push("");
  }

  if (question.type === "multi-select") {
    lines.push("(Enter numbers separated by commas, 'all', or 'none')");
  } else if (question.type === "select") {
    lines.push("(Enter a number)");
  } else if (question.type === "confirm") {
    lines.push("(yes/no)");
  }

  return lines.join("\n");
}

/**
 * Build an askQuestion function from an MCP server.
 * Detects host capabilities and adapts behavior accordingly.
 *
 * The returned function has an `.interactive` boolean property indicating
 * whether the host supports elicitation.
 *
 * Accepts both plain string questions (backward compatible) and structured
 * question objects ({message, type, options, defaults}).
 *
 * @param {Object} server — MCP server instance
 * @returns {Function & {interactive: boolean}}
 */
export function buildAskQuestion(server) {
  const canElicit = Boolean(server.getClientCapabilities?.()?.elicitation);

  const askQuestion = async (question) => {
    const isStructured = question && typeof question === "object" && question.message;

    // Non-interactive: return defaults or null
    if (!canElicit) {
      if (!isStructured) return null;
      if (question.defaults) return question.defaults;
      if (question.type === "confirm") return false;
      return null;
    }

    // Build the message text
    const message = isStructured
      ? formatStructuredQuestion(question)
      : question;

    // Call elicitInput
    let rawAnswer;
    try {
      const result = await server.elicitInput({
        message,
        requestedSchema: {
          type: "object",
          properties: {
            answer: { type: "string", description: "Your response" }
          },
          required: ["answer"]
        }
      });
      rawAnswer = result.action === "accept" ? result.content?.answer || null : null;
    } catch {
      return isStructured && question.defaults ? question.defaults : null;
    }

    if (rawAnswer === null) {
      return isStructured && question.defaults ? question.defaults : null;
    }

    // Parse structured response
    if (isStructured && question.type) {
      return parseStructuredResponse(rawAnswer, question.type, question.options);
    }

    return rawAnswer;
  };

  askQuestion.interactive = canElicit;
  return askQuestion;
}

const EVENT_LOG_LEVELS = {
  "agent:stall": "warning",
  "agent:heartbeat": "info"
};

export function buildDirectEmitter(server, runLog, extra) {
  const emitter = new EventEmitter();
  emitter.on("progress", (event) => {
    try {
      const level = EVENT_LOG_LEVELS[event.type] || "debug";
      server.sendLoggingMessage({ level, logger: "karajan", data: event });
    } catch { /* best-effort */ }
    if (runLog) runLog.logEvent(event);
  });
  const progressNotifier = buildProgressNotifier(extra);
  if (progressNotifier) emitter.on("progress", progressNotifier);
  return emitter;
}
