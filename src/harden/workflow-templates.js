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
  php: header([
    "      - uses: shivammathur/setup-php@v2",
    "        with:",
    "          php-version: '8.3'",
    "      - run: composer install --no-interaction --no-progress",
    "      - run: vendor/bin/phpstan analyse --no-progress",
    "      - run: vendor/bin/phpunit",
  ]),
};
QUALITY_BY_LANGUAGE.typescript = QUALITY_BY_LANGUAGE.javascript;

/** Stack-aware Quality workflow entry, or null for an unknown language. */
export function qualityWorkflowFor(language) {
  const body = QUALITY_BY_LANGUAGE[language];
  return body ? { file: "kj-quality.yml", blockId: "wf-quality", body } : null;
}

// Caps the net LOC delta of a PR (strict profile only — it is opinionated).
export const SHRINK_BUDGET_WORKFLOW = [
  "name: Shrink budget",
  "on:",
  "  pull_request:",
  "    branches: [main]",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  budget:",
  "    runs-on: ubuntu-latest",
  '    env: { LOC_LIMIT: "200" }',
  "    steps:",
  "      - uses: actions/checkout@v4",
  "        with:",
  "          fetch-depth: 0",
  "      - name: Net LOC delta within budget",
  "        env:",
  "          BASE_REF: ${{ github.base_ref }}",
  "        run: |",
  "          d=$(git diff --numstat \"origin/${BASE_REF}...HEAD\" -- . ':!**/*.md' ':!*.lock' ':!package-lock.json' || true)",
  '          a=$(printf "%s\\n" "$d" | awk \'$1!="-"{s+=$1}END{print s+0}\')',
  '          r=$(printf "%s\\n" "$d" | awk \'$2!="-"{s+=$2}END{print s+0}\')',
  '          net=$((a - r)); echo "net=$net (limit=$LOC_LIMIT)"',
  '          if [ "$net" -gt "$LOC_LIMIT" ]; then echo "::error::PR adds $net net lines (limit $LOC_LIMIT)"; exit 1; fi',
].join("\n");

// Packs the tarball and installs it clean — only for publishable npm packages.
export const PACK_SMOKE_WORKFLOW = [
  "name: Pack smoke",
  "on:",
  "  pull_request:",
  "    branches: [main]",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  pack-smoke:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - uses: actions/setup-node@v4",
  "        with:",
  "          node-version: 22",
  "      - run: npm ci",
  "      - name: Pack and install the tarball clean",
  "        run: |",
  "          tgz=$(npm pack --silent)",
  "          dir=$(mktemp -d)",
  '          npm install --prefix "$dir" "$PWD/$tgz" --no-audit --no-fund',
  '          echo "Tarball installs clean: $tgz"',
].join("\n");

/** Conditional workflows: shrink-budget on strict, pack-smoke when publishable. */
export function extraWorkflowsFor({ profile = "standard", publishable = false } = {}) {
  const extras = [];
  if (profile === "strict") {
    extras.push({ file: "kj-shrink-budget.yml", blockId: "wf-shrink", body: SHRINK_BUDGET_WORKFLOW });
  }
  if (publishable) {
    extras.push({ file: "kj-pack-smoke.yml", blockId: "wf-pack-smoke", body: PACK_SMOKE_WORKFLOW });
  }
  return extras;
}
