/**
 * Hook bodies + profile→hooks mapping for `kj harden` (KJC-TSK-0555).
 *
 * A body is the MANAGED portion only; harden-engine adds the shebang and the
 * kj:managed markers around it. POSIX sh. `cmds` carries stack-aware commands
 * (npm-script defaults). See docs/specs/quality-harness.md §5 for profiles.
 */

export const SHEBANG = "#!/usr/bin/env sh";

/** Hooks enabled per profile. */
export const PROFILE_HOOKS = {
  minimal: ["commit-msg"],
  standard: ["pre-commit", "commit-msg", "pre-push", "post-merge"],
  strict: ["pre-commit", "commit-msg", "pre-push", "post-merge"],
};

/** Build the managed body for a single hook. */
export function hookBody(hook, cmds = {}) {
  const lint = cmds.lint ?? "npm run -s lint";
  const format = cmds.format ?? "npm run -s format:check";
  const test = cmds.test ?? "npm test";
  switch (hook) {
    case "pre-commit":
      return [
        "# Lint + format the working tree before each commit.",
        `${lint} || { echo 'kj harden: lint failed'; exit 1; }`,
        `${format} || { echo 'kj harden: format check failed'; exit 1; }`,
      ].join("\n");
    case "commit-msg":
      return [
        "# Conventional Commits + block AI self-attribution.",
        'msg_file="$1"',
        "if command -v npx >/dev/null 2>&1; then",
        "  npx --no-install commitlint --edit \"$msg_file\" || { echo 'kj harden: commitlint failed'; exit 1; }",
        "fi",
        "if grep -qiE 'co-authored-by:.*(claude|gpt|copilot|gemini)|(generated|written) (by|with) .*(claude|gpt|copilot)' \"$msg_file\"; then",
        "  echo 'kj harden: AI attribution is not allowed in commit messages'; exit 1",
        "fi",
      ].join("\n");
    case "pre-push":
      return [
        "# Run the test suite before pushing.",
        `${test} || { echo 'kj harden: tests failed'; exit 1; }`,
      ].join("\n");
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
