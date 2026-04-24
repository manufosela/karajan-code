/**
 * In-memory runtime overrides (e.g. `roles.coder.provider` set for the
 * current process session, not persisted to disk).
 *
 * Why this lives at the session layer (not under `src/mcp/`):
 *
 *   Pre-v2.7.5, the overrides store lived in `src/mcp/preflight.js`. That
 *   made `src/commands/agents.js` (CLI) do
 *     `await import("../mcp/preflight.js")`
 *   which is a **layer violation**: commands are the top layer, MCP is a
 *   peer interface. A CLI command knowing about the MCP server's
 *   preflight state coupled two runtimes that should be independent.
 *
 *   The "runtime override" concept is runtime-agnostic — both CLI and MCP
 *   need an in-memory scratchpad for "this process should use this
 *   provider for role X for the rest of its life". Putting it here makes
 *   both layers depend on `src/session/` (a neutral module) instead of on
 *   each other.
 *
 * Lifetime: the store lives for as long as the Node process. CLI
 * invocations are short-lived (override is lost at exit — that's fine,
 * they write to config if they want persistence). The MCP server process
 * is long-lived; the override survives across tool calls until
 * `clearRuntimeOverrides()` is called (typically by `ackPreflight()`).
 *
 * Contents: a flat `{ [key]: value }` map. Keys are typically role names
 * (`coder`, `reviewer`, `planner`), values are provider slugs (`claude`,
 * `codex`, `gemini`). Consumers shape-validate at read time.
 */

let overrides = {};

/**
 * Return a shallow copy of the current overrides. Never returns the
 * internal reference so callers cannot mutate it by accident.
 */
export function getRuntimeOverrides() {
  return { ...overrides };
}

/**
 * Set a single override. Silently rejects nullish keys.
 *
 * @param {string} key
 * @param {unknown} value
 */
export function setRuntimeOverride(key, value) {
  if (!key) return;
  overrides[key] = value;
}

/**
 * Drop all overrides. Used by `ackPreflight()` after it transfers its
 * configured overrides onto this store, to ensure we start from a clean
 * slate per MCP session.
 */
export function clearRuntimeOverrides() {
  overrides = {};
}
