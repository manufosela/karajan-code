import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";
import { resolveBin } from "./resolve-bin.js";

/**
 * Safely parse a JSON line, returning null on failure.
 */
function tryParseJson(line) {
  try {
    return JSON.parse(line);
  } catch { return null; }
}

/**
 * Extract a human-readable error message from Claude's raw NDJSON stderr output.
 * Claude emits system init, api_retry, assistant error, and result lines.
 * We extract just the meaningful error text, discarding the JSON noise.
 */
export function sanitizeClaudeError(raw) {
  if (!raw) return "Unknown error";
  const lines = raw.split("\n").filter(Boolean);

  // Look for a result line with the actual error
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = tryParseJson(lines[i]);
    if (!obj) continue;
    if (obj.type === "result" && obj.result) return String(obj.result);
    if (obj.type === "assistant" && obj.message?.content) {
      const text = obj.message.content
        .filter(b => b.type === "text" && b.text)
        .map(b => b.text)
        .join(" ");
      if (text) return text;
    }
  }

  // If no JSON parsed, return first non-JSON line or truncated raw
  for (const line of lines) {
    if (!line.startsWith("{")) return line.slice(0, 200);
  }

  return raw.slice(0, 200);
}

/**
 * Try to extract a result string from a parsed JSON object.
 * Returns the result string or null if the object is not a result message.
 */
function extractResultText(obj) {
  if (obj.type === "result" && obj.result) {
    return typeof obj.result === "string" ? obj.result : JSON.stringify(obj.result);
  }
  if (obj.result && typeof obj.result === "string") {
    return obj.result;
  }
  return null;
}

/**
 * Collect text parts from an assistant message's content blocks.
 */
function collectAssistantText(obj) {
  if (obj.type !== "assistant" || !obj.message?.content) return [];
  return obj.message.content
    .filter(block => block.type === "text" && block.text)
    .map(block => block.text);
}

/**
 * Extract usage metrics from stream-json/json NDJSON output.
 * Looks for the "result" line which contains total_cost_usd,
 * usage.input_tokens/output_tokens, and modelUsage.
 * Returns an object with tokens_in, tokens_out, cost_usd, model or null if not found.
 */
function extractUsageFromStreamJson(raw) {
  const lines = (raw || "").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = tryParseJson(lines[i]);
    if (!obj || obj.type !== "result") continue;

    const tokens_in = obj.usage?.input_tokens ?? 0;
    const tokens_out = obj.usage?.output_tokens ?? 0;
    const cost_usd = obj.total_cost_usd ?? undefined;
    const modelUsage = obj.modelUsage;
    const model = modelUsage ? Object.keys(modelUsage)[0] || null : null;

    return { tokens_in, tokens_out, cost_usd, model };
  }
  return null;
}

/**
 * Extract the final text result from stream-json NDJSON output.
 * Each line is a JSON object. We collect assistant text content from
 * "result" messages and fall back to accumulating "content_block_delta" text.
 */
function extractTextFromStreamJson(raw) {
  const lines = (raw || "").split("\n").filter(Boolean);
  // Try to find a "result" message with the final text
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = tryParseJson(lines[i]);
    if (!obj) continue;
    const result = extractResultText(obj);
    if (result) return result;
  }
  // Fallback: accumulate all assistant text deltas
  const parts = [];
  for (const line of lines) {
    const obj = tryParseJson(line);
    if (obj) parts.push(...collectAssistantText(obj));
  }
  return parts.join("") || raw;
}

/**
 * Create a wrapping onOutput that parses stream-json lines and forwards
 * meaningful content (assistant text, tool usage) to the original callback.
 */
function createStreamJsonFilter(onOutput) {
  if (!onOutput) return null;
  return ({ stream, line }) => {
    try {
      const obj = JSON.parse(line);
      // Forward assistant text messages
      if (obj.type === "assistant" && obj.message?.content) {
        for (const block of obj.message.content) {
          if (block.type === "text" && block.text) {
            onOutput({ stream, line: block.text.slice(0, 200) });
          } else if (block.type === "tool_use") {
            onOutput({ stream, line: `[tool: ${block.name}]` });
          }
        }
        return;
      }
      // Forward result
      if (obj.type === "result") {
        const summary = typeof obj.result === "string"
          ? obj.result.slice(0, 200)
          : "result received";
        onOutput({ stream, line: `[result] ${summary}` });
        return;
      }
    } catch { /* not JSON, forward raw */ }
    onOutput({ stream, line });
  };
}

/**
 * Build clean execa options for Claude subprocess.
 *
 * Three critical fixes for running `claude -p` from Node.js:
 *
 * 1. Strip CLAUDECODE env var — Claude Code 2.x sets this to block nested
 *    sessions.  The spawned `claude -p` is a separate non-interactive
 *    invocation, not a true nested session.
 *
 * 2. Detach stdin (stdin: "ignore") — When launched from Node.js (which is
 *    how Claude Code / Karajan MCP runs), the child inherits the parent's
 *    stdin.  `claude -p` then blocks waiting to read from a stdin that the
 *    parent is already consuming.  Ignoring stdin prevents the hang.
 *
 * 3. Claude Code 2.x writes all structured output (stream-json, json) to
 *    stderr, NOT stdout.  The agent must read from stderr for the actual
 *    response data.
 */
function cleanExecaOpts(extra = {}) {
  const { CLAUDECODE, ...env } = process.env;
  return { env, stdin: "ignore", ...extra };
}

/**
 * Pick the best raw output from a claude subprocess result.
 * Claude 2.x sends structured output to stderr; stdout is often empty.
 */
function pickOutput(res) {
  return res.stdout || res.stderr || "";
}

/**
 * Default tools to allow for Claude subprocess.
 * Since claude -p runs non-interactively (stdin: "ignore"), it cannot ask for
 * permission approval.  Without --allowedTools, it blocks waiting for approval
 * that never comes.
 */
const ALLOWED_TOOLS = [
  "Read", "Write", "Edit", "Bash", "Glob", "Grep"
];

export class ClaudeAgent extends BaseAgent {
  async runTask(task) {
    const role = task.role || "coder";
    const model = this.getRoleModel(role);
    const result = await this._runTaskExec(task, model, role);
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Claude model "${model}" not supported — retrying with agent default`);
      return this._runTaskExec(task, null, role);
    }
    return result;
  }

  async reviewTask(task) {
    const role = task.role || "reviewer";
    const model = this.getRoleModel(role);
    const result = await this._reviewTaskExec(task, model);
    if (!result.ok && model && this.isModelNotSupportedError(result)) {
      this.logger?.warn(`Claude model "${model}" not supported — retrying with agent default`);
      return this._reviewTaskExec(task, null);
    }
    return result;
  }

  async _runTaskExec(task, model, role) {
    const args = ["-p", task.prompt, "--allowedTools", ...ALLOWED_TOOLS];
    if (model) args.push("--model", model);

    // Use stream-json when onOutput is provided to get real-time feedback
    if (task.onOutput) {
      args.push("--output-format", "stream-json", "--verbose");
      const streamFilter = createStreamJsonFilter(task.onOutput);
      const res = await runCommand(resolveBin("claude"), args, cleanExecaOpts({
        onOutput: streamFilter,
        silenceTimeoutMs: task.silenceTimeoutMs,
        timeout: task.timeoutMs
      }));
      const raw = pickOutput(res);
      const output = extractTextFromStreamJson(raw);
      const usage = extractUsageFromStreamJson(raw);
      return { ok: res.exitCode === 0, output, error: res.exitCode === 0 ? "" : sanitizeClaudeError(raw), exitCode: res.exitCode, ...usage };
    }

    // Without streaming, use json output to get structured response via stderr
    args.push("--output-format", "json");
    const res = await runCommand(resolveBin("claude"), args, cleanExecaOpts());
    const raw = pickOutput(res);
    const output = extractTextFromStreamJson(raw);
    const usage = extractUsageFromStreamJson(raw);
    return { ok: res.exitCode === 0, output, error: res.exitCode === 0 ? "" : sanitizeClaudeError(raw), exitCode: res.exitCode, ...usage };
  }

  async _reviewTaskExec(task, model) {
    const args = ["-p", task.prompt, "--allowedTools", ...ALLOWED_TOOLS, "--output-format", "stream-json", "--verbose"];
    if (model) args.push("--model", model);
    const res = await runCommand(resolveBin("claude"), args, cleanExecaOpts({
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    }));
    const raw = pickOutput(res);
    const usage = extractUsageFromStreamJson(raw);
    return { ok: res.exitCode === 0, output: raw, error: res.exitCode === 0 ? "" : raw, exitCode: res.exitCode, ...usage };
  }
}
