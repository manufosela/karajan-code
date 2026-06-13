/**
 * CI workflow templates for `kj harden` (KJC-TSK-0557).
 *
 * Generic, language-agnostic GitHub Actions that `kj harden` seeds into a
 * target repo's `.github/workflows/`. Bodies are plain strings (NOT template
 * literals) so the `${{ … }}` GitHub expressions survive verbatim.
 */

// Blocks AI self-attribution in PR commit messages. Pure bash + grep, no Node.
// Pins github.base_ref to an env var (never interpolated into the run block).
export const NO_AI_ATTRIBUTION_WORKFLOW = [
  "name: Block AI attribution",
  "on:",
  "  pull_request:",
  "    branches: [main]",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  scan:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "        with:",
  "          fetch-depth: 0",
  "      - name: Scan commit messages for AI attribution",
  "        env:",
  "          BASE_REF: ${{ github.base_ref }}",
  "        run: |",
  '          msgs=$(git log --format=%B "origin/${BASE_REF}...HEAD" || true)',
  "          pat='co-authored-by:.*(claude|anthropic|openai|chatgpt|gpt-[0-9]|copilot|gemini|cursor|windsurf|codeium|deepseek)'",
  "          pat=\"$pat|(generated|written|authored|assisted|powered) (by|with|using) .*(claude|anthropic|openai|copilot|gemini)\"",
  '          if printf "%s" "$msgs" | grep -qiE "$pat"; then',
  '            echo "::error::AI attribution detected in commit messages"; exit 1',
  "          fi",
  '          echo "AI attribution scan: clean"',
].join("\n");

/** Workflows harden seeds. style:hash ⇒ kj:managed block in YAML comments. */
export const WORKFLOWS = [
  { file: "kj-no-ai-attribution.yml", blockId: "wf-no-ai", body: NO_AI_ATTRIBUTION_WORKFLOW },
];
