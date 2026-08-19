import { BaseAgent } from "./base-agent.js";
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
 * usage.input_tokens/output_tokens, cache_read_input_tokens,
 * cache_creation_input_tokens, and modelUsage.
 *
 * `cached_tokens` aggregates both cache_read_input_tokens (tokens served
 * from Anthropic's automatic prompt cache) and cache_creation_input_tokens
 * (tokens just written to the cache during this call). The sum represents
 * the total volume of input that benefited from prompt-caching machinery.
 *
 * Returns an object with tokens_in, tokens_out, cached_tokens, cost_usd,
 * model or null if not found.
 */
function extractUsageFromStreamJson(raw) {
  const events = parseClaudeEvents(raw);
  for (let i = events.length - 1; i >= 0; i--) {
    const obj = events[i];
    if (obj.type !== "result") continue;

    const tokens_in = obj.usage?.input_tokens ?? 0;
    const tokens_out = obj.usage?.output_tokens ?? 0;
    const cache_read = obj.usage?.cache_read_input_tokens ?? 0;
    const cache_creation = obj.usage?.cache_creation_input_tokens ?? 0;
    const cached_tokens = cache_read + cache_creation;
    const cost_usd = obj.total_cost_usd ?? undefined;
    const modelUsage = obj.modelUsage;
    const model = modelUsage ? Object.keys(modelUsage)[0] || null : null;

    return { tokens_in, tokens_out, cached_tokens, cost_usd, model };
  }
  return null;
}

/**
 * Normalize Claude's output payload to a flat array of event objects.
 *
 * Claude 2.x supports two on-disk shapes depending on the output-format flag:
 *
 *   --output-format stream-json → NDJSON, one event JSON per line
 *   --output-format json        → a single JSON array with every event
 *
 * The legacy path assumed NDJSON and silently dropped the `json` variant
 * (split("\n") returned one unparseable "line" containing the whole array,
 * extract returned empty, caller fell back to the raw string — which made
 * `kj plan` save the whole stream as `approach` with zero HUs). Handle both
 * shapes here so callers see a uniform list of events regardless of flag.
 */
function parseClaudeEvents(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return [];
  // `--output-format json` → single JSON array.
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr.filter((o) => o && typeof o === "object");
    } catch { /* fall through to NDJSON */ }
  }
  // `--output-format stream-json` → NDJSON, one event per line.
  const events = [];
  for (const line of trimmed.split("\n")) {
    const obj = tryParseJson(line);
    if (obj && typeof obj === "object") events.push(obj);
  }
  return events;
}

/**
 * Extract the final text result from Claude's output (either stream-json
 * NDJSON or single-array json — see parseClaudeEvents). We look for the
 * `result` message first (holds the final text); if missing, concatenate
 * every assistant text block encountered.
 */
function extractTextFromStreamJson(raw) {
  const events = parseClaudeEvents(raw);
  // Walk from the end — the final `result` event is the last one.
  for (let i = events.length - 1; i >= 0; i--) {
    const result = extractResultText(events[i]);
    if (result) return result;
  }
  // Fallback: accumulate every assistant text block in order.
  const parts = [];
  for (const obj of events) parts.push(...collectAssistantText(obj));
  return parts.join("") || raw;
}

/**
 * Create a wrapping onOutput that parses stream-json lines and forwards
 * meaningful content (assistant text, tool usage) to the original callback.
 */
function summarizeToolCall(name, input = {}) {
  // Produce concise human-readable action line from tool_use block
  const rel = (p) => String(p || "").replace(process.cwd() + "/", "");
  switch (name) {
    case "Read": return `Read ${rel(input.file_path)}`;
    case "Write": return `Write ${rel(input.file_path)}`;
    case "Edit": return `Edit ${rel(input.file_path)}`;
    case "MultiEdit": return `MultiEdit ${rel(input.file_path)} (${(input.edits || []).length} edits)`;
    case "NotebookEdit": return `NotebookEdit ${rel(input.notebook_path)}`;
    case "Glob": return `Glob ${input.pattern || ""}`.trim();
    case "Grep": return `Grep "${(input.pattern || "").slice(0, 60)}"${input.path ? ` in ${rel(input.path)}` : ""}`;
    case "Bash": {
      const cmd = String(input.command || "").replaceAll(/\s+/g, " ").slice(0, 100);
      return `Bash $ ${cmd}`;
    }
    case "TodoWrite": return `Todo ${(input.todos || []).length} items`;
    case "WebFetch": return `WebFetch ${input.url || ""}`;
    case "WebSearch": return `WebSearch "${(input.query || "").slice(0, 60)}"`;
    case "Task": return `Agent: ${input.subagent_type || "?"} — ${(input.description || "").slice(0, 60)}`;
    default: return `${name}${Object.keys(input).length > 0 ? " (…)" : ""}`;
  }
}

/**
 * Translate a Claude stream-json event into a human-readable summary.
 *
 * Returns a `{ line, kind }` object for the cli-progress reporter to
 * display, OR `null` to suppress (the event is structural noise).
 *
 * Whitelist semantics on purpose: pre-v2.7.5 the filter ONLY recognised
 * `assistant` + `result` and forwarded everything else as raw JSON,
 * which dumped 6 KB of `system/init` + `rate_limit_event` to the user
 * on every `kj plan`. Now we recognise every event type Claude can
 * emit and either condense it to one line or drop it. Unknown types
 * are dropped silently unless DEBUG_KJ_AGENT is set.
 */
export function translateStreamJsonEvent(obj) {
  switch (obj.type) {
    case "system": {
      // The init frame announces session id + model. Useful as a single
      // status line on first connect; the rate_limit subtype on a
      // healthy session is pure noise — suppress.
      if (obj.subtype === "init") {
        const model = typeof obj.model === "string" ? obj.model : "?";
        return { line: `Claude session ready (model: ${model.replace(/\[.*\]/, "")})`, kind: "text" };
      }
      return null;
    }
    case "rate_limit_event": {
      const status = obj.rate_limit_info?.status;
      // Only surface when actually throttled — "allowed" is the happy
      // path and surfaces every few seconds during normal runs.
      if (status && status !== "allowed") {
        return { line: `Rate limit: ${status}`, kind: "text" };
      }
      return null;
    }
    case "user": {
      // Echoes of the previous tool's output coming back into the
      // conversation. Adding a line per echo would double the noise of
      // the corresponding tool_use line, which we already render.
      return null;
    }
    case "assistant": {
      const content = obj.message?.content;
      if (!Array.isArray(content)) return null;
      // Each content block becomes a separate line — we return them
      // through the caller's emit-many path below.
      return { _multi: true, blocks: content };
    }
    case "result": {
      const summary = typeof obj.result === "string"
        ? obj.result.split("\n")[0].slice(0, 120)
        : "result received";
      return { line: `done: ${summary}` };
    }
    default: {
      if (process.env.DEBUG_KJ_AGENT) {
        return { line: `[debug] unknown event: ${obj.type}` };
      }
      return null;
    }
  }
}

export function createStreamJsonFilter(onOutput) {
  if (!onOutput) return null;
  return ({ stream, line }) => {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      // Not JSON — forward verbatim ONLY if it's short and not a partial
      // JSON chunk (some agents print stderr diagnostics through the
      // same channel). Anything that smells like JSON-debris gets
      // dropped to keep the CLI clean.
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("[") && trimmed.length < 200) {
        onOutput({ stream, line: trimmed });
      }
      return;
    }

    const summary = translateStreamJsonEvent(obj);
    if (!summary) return;

    // Multi-block assistant payload: one line per content block.
    if (summary._multi) {
      for (const block of summary.blocks) {
        if (block.type === "text" && block.text) {
          const firstLine = block.text.split("\n")[0].trim().slice(0, 120);
          if (firstLine) onOutput({ stream, line: firstLine, kind: "text" });
        } else if (block.type === "tool_use") {
          onOutput({ stream, line: summarizeToolCall(block.name, block.input), kind: "tool" });
        } else if (block.type === "thinking" && block.thinking) {
          onOutput({ stream, line: `thinking: ${block.thinking.slice(0, 80).replaceAll(/\s+/g, " ")}…`, kind: "thinking" });
        }
      }
      return;
    }

    onOutput({ stream, line: summary.line, kind: summary.kind });
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
  const { CLAUDECODE: _CLAUDECODE, ...env } = process.env;
  // PAR-H (KJC-TSK-0631): extra.env ADDS to the inherited env (lane slot
  // vars) instead of replacing it wholesale.
  const { env: extraEnv, ...rest } = extra;
  return { env: extraEnv ? { ...env, ...extraEnv } : env, stdin: "ignore", ...rest };
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

/**
 * Base CLI args for a task (Φ1-D, KJC-PCS-0057). When the role provides the
 * prompt split in stable/volatile buckets, the stable block travels via
 * --append-system-prompt — the CLI places cache breakpoints on the system
 * block, so Anthropic's prompt cache hits on it across iterations — and only
 * the volatile block goes in the -p message. Without the split, legacy
 * single-prompt behavior is unchanged.
 */
function buildPromptArgs(task) {
  if (task.stablePrompt && task.volatilePrompt) {
    return ["-p", task.volatilePrompt, "--append-system-prompt", task.stablePrompt, "--allowedTools", ...ALLOWED_TOOLS];
  }
  return ["-p", task.prompt, "--allowedTools", ...ALLOWED_TOOLS];
}

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

  async _runTaskExec(task, model, _role) {
    const args = buildPromptArgs(task);
    if (model) args.push("--model", model);
    // PL-C (KJC-TSK-0735): el rol del subproceso viaja en KJ_POLICY_ROLE —
    // si su harness corre hooks (claude -p), el tier A evalúa la policy con
    // el rol que ACTÚA. El rol del ORQUESTADOR es autoritativo: task.env no
    // puede spoofearlo (catch de codex: sería un bypass de reglas por rol).
    const roleEnv = task.role ? { ...task.env, KJ_POLICY_ROLE: task.role } : task.env;

    // Use stream-json when onOutput is provided to get real-time feedback
    if (task.onOutput) {
      args.push("--output-format", "stream-json", "--verbose");
      const streamFilter = createStreamJsonFilter(task.onOutput);
      const res = await this.runCommand(resolveBin("claude"), args, cleanExecaOpts({
        onOutput: streamFilter,
        silenceTimeoutMs: task.silenceTimeoutMs,
        timeout: task.timeoutMs,
        env: roleEnv,
        cwd: task.cwd
      }));
      const raw = pickOutput(res);
      const output = extractTextFromStreamJson(raw);
      const usage = extractUsageFromStreamJson(raw);
      return { ok: res.exitCode === 0, output, error: res.exitCode === 0 ? "" : sanitizeClaudeError(raw), exitCode: res.exitCode, ...usage };
    }

    // Without streaming, use json output to get structured response via stderr
    args.push("--output-format", "json");
    const res = await this.runCommand(resolveBin("claude"), args, cleanExecaOpts({ env: roleEnv, cwd: task.cwd }));
    const raw = pickOutput(res);
    const output = extractTextFromStreamJson(raw);
    const usage = extractUsageFromStreamJson(raw);
    return { ok: res.exitCode === 0, output, error: res.exitCode === 0 ? "" : sanitizeClaudeError(raw), exitCode: res.exitCode, ...usage };
  }

  async _reviewTaskExec(task, model) {
    const args = [...buildPromptArgs(task), "--output-format", "stream-json", "--verbose"];
    if (model) args.push("--model", model);
    const res = await this.runCommand(resolveBin("claude"), args, cleanExecaOpts({
      onOutput: task.onOutput,
      silenceTimeoutMs: task.silenceTimeoutMs,
      timeout: task.timeoutMs,
      env: task.env
    }));
    const raw = pickOutput(res);
    const usage = extractUsageFromStreamJson(raw);
    return { ok: res.exitCode === 0, output: raw, error: res.exitCode === 0 ? "" : raw, exitCode: res.exitCode, ...usage };
  }
}
