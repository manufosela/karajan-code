/**
 * RTK (Rust Token Killer) prompt instruction snippet.
 * Injected into coder/reviewer prompts when RTK is detected.
 */
export const RTK_INSTRUCTIONS = [
  "## Token Optimization (RTK detected)",
  "RTK is installed. Prefix ALL Bash tool calls with `rtk` to reduce token usage:",
  "- Use `rtk git status` instead of `git status`",
  "- Use `rtk git diff` instead of `git diff`",
  "- Use `rtk ls` instead of `ls`",
  "- Use `rtk find` instead of `find`",
  "- Use `rtk grep` instead of `grep`",
  "- Use `rtk cat` instead of `cat`",
  "This does NOT apply to non-Bash tools (Read, Write, Edit, Glob, Grep)."
].join("\n");

/**
 * Build RTK instructions when RTK is detected.
 * @param {{ rtkAvailable?: boolean }} options
 * @returns {string}
 */
export function buildRtkInstructions({ rtkAvailable = false } = {}) {
  if (!rtkAvailable) return "";
  return RTK_INSTRUCTIONS;
}
