import { BaseAgent } from "./base-agent.js";
import { runCommand } from "../utils/process.js";
import { resolveBin } from "./resolve-bin.js";

/**
 * Extract the final text result from stream-json NDJSON output.
 * Each line is a JSON object. We collect assistant text content from
 * "result" messages and fall back to accumulating "content_block_delta" text.
 */
function extractTextFromStreamJson(raw) {
  const lines = (raw || "").split("\n").filter(Boolean);
  // Try to find a "result" message with the final text
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.type === "result" && obj.result) {
        return typeof obj.result === "string" ? obj.result : JSON.stringify(obj.result);
      }
      // Claude Code stream-json final message
      if (obj.result && typeof obj.result === "string") {
        return obj.result;
      }
    } catch { /* skip unparseable lines */ }
  }
  // Fallback: accumulate all assistant text deltas
  const parts = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === "assistant" && obj.message?.content) {
        for (const block of obj.message.content) {
          if (block.type === "text" && block.text) parts.push(block.text);
        }
      }
    } catch { /* skip */ }
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
    const args = ["-p", task.prompt, "--allowedTools", ...ALLOWED_TOOLS];
    const model = this.getRoleModel(role);
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
      return { ok: res.exitCode === 0, output, error: res.exitCode !== 0 ? raw : "", exitCode: res.exitCode };
    }

    // Without streaming, use json output to get structured response via stderr
    args.push("--output-format", "json");
    const res = await runCommand(resolveBin("claude"), args, cleanExecaOpts());
    const raw = pickOutput(res);
    const output = extractTextFromStreamJson(raw);
    return { ok: res.exitCode === 0, output, error: res.exitCode !== 0 ? raw : "", exitCode: res.exitCode };
  }

  async reviewTask(task) {
    const args = ["-p", task.prompt, "--allowedTools", ...ALLOWED_TOOLS, "--output-format", "stream-json", "--verbose"];
    const model = this.getRoleModel(task.role || "reviewer");
    if (model) args.push("--model", model);
    const res = await runCommand(resolveBin("claude"), args, cleanExecaOpts({
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs
    }));
    const raw = pickOutput(res);
    return { ok: res.exitCode === 0, output: raw, error: res.exitCode !== 0 ? raw : "", exitCode: res.exitCode };
  }
}
