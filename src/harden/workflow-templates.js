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

/** Universal workflows (every stack). style:hash ⇒ marker in YAML comments. */
export const WORKFLOWS = [
  { file: "kj-no-ai-attribution.yml", blockId: "wf-no-ai", body: NO_AI_ATTRIBUTION_WORKFLOW },
];

const header = (steps) =>
  [
    "name: Quality",
    "on:",
    "  pull_request:",
    "    branches: [main]",
    "jobs:",
    "  quality:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    ...steps,
  ].join("\n");

const QUALITY_BY_LANGUAGE = {
  javascript: header([
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    "      - run: npm ci",
    "      - run: npm run -s lint --if-present",
    "      - run: npm test",
  ]),
  python: header([
    "      - uses: actions/setup-python@v5",
    "        with:",
    "          python-version: '3.12'",
    "      - run: pip install ruff pytest",
    "      - run: ruff check .",
    "      - run: pytest",
  ]),
  go: header([
    "      - uses: actions/setup-go@v5",
    "        with:",
    "          go-version: stable",
    "      - run: go vet ./...",
    "      - run: go test ./...",
  ]),
};
QUALITY_BY_LANGUAGE.typescript = QUALITY_BY_LANGUAGE.javascript;

/** Stack-aware Quality workflow entry, or null for an unknown language. */
export function qualityWorkflowFor(language) {
  const body = QUALITY_BY_LANGUAGE[language];
  return body ? { file: "kj-quality.yml", blockId: "wf-quality", body } : null;
}
