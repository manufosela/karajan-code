/**
 * Hook bodies + profile→hooks mapping for `kj harden` (KJC-TSK-0555, 0562).
 *
 * A body is the MANAGED portion only; harden-engine adds the shebang and the
 * kj:managed markers around it. Pure POSIX sh — the universal checks (commit
 * format, AI-attribution) need no toolchain, and lint/format/test lines call
 * the project's NATIVE commands (from `cmds`), only when present. No npm/Node
 * is imposed on non-JS repos. See docs/specs/quality-harness.md §5.
 */

const CONVENTIONAL_TYPES = "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert";
const AI_ATTRIBUTION = "co-authored-by:.*(claude|gpt|copilot|gemini)|(generated|written) (by|with) .*(claude|gpt|copilot)";

export const SHEBANG = "#!/usr/bin/env sh";

/** Hooks enabled per profile. */
export const PROFILE_HOOKS = {
  minimal: ["commit-msg"],
  standard: ["pre-commit", "commit-msg", "pre-push", "post-merge"],
  strict: ["pre-commit", "commit-msg", "pre-push", "post-merge"],
};

/** Build the managed body for a single hook. */
export function hookBody(hook, cmds = {}) {
  switch (hook) {
    case "pre-commit": {
      const lines = ["# Lint + format the working tree with the project's native tools."];
      if (cmds.lint) lines.push(`${cmds.lint} || { echo 'kj harden: lint failed'; exit 1; }`);
      if (cmds.format) lines.push(`${cmds.format} || { echo 'kj harden: format check failed'; exit 1; }`);
      if (!cmds.lint && !cmds.format) lines.push("# (no lint/format command detected for this stack)");
      lines.push(
        "# v4 review gate (ENV-C1, opt-in via `kj review --install-gate`):",
        "# a staged diff only enters with a recorded cross-AI approved verdict.",
        "if [ -f .karajan/review-gate ]; then",
        "  if ! command -v kj >/dev/null 2>&1; then",
        "    echo 'kj: review gate is enabled but kj is not installed — see karajancode.com/docs/getting-started/installation'; exit 1",
        "  fi",
        "  kj review --check || { echo 'kj: no approved cross-AI verdict for the staged diff — run `kj review --staged`'; exit 1; }",
        "fi"
      );
      return lines.join("\n");
    }
    case "commit-msg":
      // Pure POSIX — Conventional Commits header, length cap, AI-attribution.
      return [
        'msg_file="$1"',
        'header=$(head -n1 "$msg_file")',
        `if ! printf '%s' "$header" | grep -qE '^(${CONVENTIONAL_TYPES})(\\([a-z0-9._-]+\\))?!?: .+'; then`,
        "  echo 'kj harden: commit header must follow Conventional Commits (type: subject)'; exit 1",
        "fi",
        'if [ "${#header}" -gt 100 ]; then echo \'kj harden: commit header exceeds 100 chars\'; exit 1; fi',
        `if grep -qiE '${AI_ATTRIBUTION}' "$msg_file"; then`,
        "  echo 'kj harden: AI attribution is not allowed in commit messages'; exit 1",
        "fi",
      ].join("\n");
    case "pre-push": {
      const lines = [
        "# Identity guard — never push without a configured git identity.",
        'if [ -z "$(git config user.email)" ] || [ -z "$(git config user.name)" ]; then',
        "  echo 'kj harden: git user.name/user.email not set — refusing to push'; exit 1",
        "fi",
        'echo "kj harden: pushing as $(git config user.name) <$(git config user.email)>"',
        "# Run the test suite before pushing.",
      ];
      if (cmds.test) lines.push(`${cmds.test} || { echo 'kj harden: tests failed'; exit 1; }`);
      else lines.push("# (no test command detected for this stack)");
      return lines.join("\n");
    }
    case "post-merge":
      return [
        "# Refresh the local RAG index so retrieval never serves stale code.",
        "if command -v kj >/dev/null 2>&1; then",
        "  kj rag index --since auto >/dev/null 2>&1 || true",
        "fi",
      ].join("\n");
    default:
      throw new Error(`Unknown hook: ${hook}`);
  }
}
