/**
 * CI workflow templates for `kj harden` (KJC-TSK-0557).
 *
 * Generic, language-agnostic GitHub Actions that `kj harden` seeds into a
 * target repo's `.github/workflows/`. Bodies are plain strings (NOT template
 * literals) so the `${{ … }}` GitHub expressions survive verbatim.
 */

// Blocks AI self-attribution in PR commit messages. Pure bash + grep, no Node.
// Pins github.base_ref to an env var (never interpolated into the run block).
// KJC-BUG-0136 (issue #1374): actions pinned to full commit SHAs — a
// mutable tag lets its owner run arbitrary code inside EVERY hardened
// repo's CI, with access to the workflow's secrets; 5 of this project's 7
// audit findings came from files kj itself generated. The version rides in
// a comment (the practice kj audit demands). To bump one:
//   gh api repos/<owner>/<repo>/commits/<tag> --jq .sha
export const PINNED_ACTIONS = {
  checkout: "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4",
  setupNode: "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4",
  setupPython: "actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065 # v5",
  setupGo: "actions/setup-go@40f1582b2485089dde7abd97c1529aa768e1baff # v5",
  setupPhp: "shivammathur/setup-php@f3e473d116dcccaddc5834248c87452386958240 # v2",
};

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
  `      - uses: ${PINNED_ACTIONS.checkout}`,
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

// PL-C (KJC-TSK-0735) — tier C del ADR 0001: re-check merge-blocking en CI
// (cubre el hook local manipulado). Solo se siembra con policy declarada;
// npx PINEADO a la versión del kj que corrió harden — jamás @latest en CI.
export const policyWorkflowFor = (kjVersion, kjName = "karajan-code") => [
  "name: Policy",
  "on:",
  "  pull_request:",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  policy-check:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  `      - uses: ${PINNED_ACTIONS.checkout}`,
  "        with:",
  "          fetch-depth: 0",
  `      - uses: ${PINNED_ACTIONS.setupNode}`,
  "        with:",
  "          node-version: 22",
  "      - name: kj policy check (strict) on the PR diff",
  "        env:",
  "          BASE_REF: ${{ github.base_ref }}",
  "        run: |",
  `          if [ -f bin/kj.js ]; then npm ci --ignore-scripts && KJ="node bin/kj.js"; else KJ="npx --yes ${kjName}@${kjVersion}"; fi`,
  '          $KJ policy check --range "origin/${BASE_REF}...HEAD" --strict',
  "", // línea en blanco pre-marcador: prettier la exige tras un block scalar
].join("\n");

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
    `      - uses: ${PINNED_ACTIONS.checkout}`,
    ...steps,
  ].join("\n");

// Per-package-manager commands (KJC-BUG-0131, issue #1330): `npm ci` in a
// pnpm/yarn repo dies with EUSAGE (no package-lock.json). corepack ships with
// Node 22 and resolves the right pnpm/yarn from `packageManager` — no
// third-party action. Yarn scripts run through `npm run` (scripts don't touch
// the lockfile). Lint ENFORCES — never --if-present: a step that passes when
// its script is missing protects nothing (KJC-BUG-0137, issue #1357); the
// engine omits the step instead when the project has no lint script.
export const PM_COMMANDS = {
  npm: { setup: [], install: "npm ci", lint: "npm run -s lint", test: "npm test" },
  pnpm: {
    setup: ["      - run: corepack enable"],
    install: "pnpm install --frozen-lockfile",
    lint: "pnpm run -s lint",
    test: "pnpm test",
  },
  yarn: {
    setup: ["      - run: corepack enable"],
    install: "yarn install --frozen-lockfile",
    lint: "npm run -s lint",
    test: "yarn test",
  },
};

const nodeSetupSteps = (pm) => [
  `      - uses: ${PINNED_ACTIONS.setupNode}`,
  "        with:",
  "          node-version: 22",
  ...(PM_COMMANDS[pm] || PM_COMMANDS.npm).setup,
  `      - run: ${(PM_COMMANDS[pm] || PM_COMMANDS.npm).install}`,
];

const QUALITY_BY_LANGUAGE = {
  python: header([
    `      - uses: ${PINNED_ACTIONS.setupPython}`,
    "        with:",
    "          python-version: '3.12'",
    "      - run: pip install ruff pytest",
    "      - run: ruff check .",
    "      - run: pytest",
  ]),
  go: header([
    `      - uses: ${PINNED_ACTIONS.setupGo}`,
    "        with:",
    "          go-version: stable",
    "      - run: go vet ./...",
    "      - run: go test ./...",
  ]),
  php: header([
    `      - uses: ${PINNED_ACTIONS.setupPhp}`,
    "        with:",
    "          php-version: '8.3'",
    "      - run: composer install --no-interaction --no-progress",
    "      - run: vendor/bin/phpstan analyse --no-progress",
    "      - run: vendor/bin/phpunit",
  ]),
};
/**
 * Stack-aware Quality workflow entry, or null for an unknown language.
 * `lint:false` drops the JS lint step entirely (project has no lint script,
 * KJC-BUG-0137) — mirroring the local hook, which also omits it.
 */
export function qualityWorkflowFor(language, pm = "npm", lint = true) {
  const c = PM_COMMANDS[pm] || PM_COMMANDS.npm;
  const body =
    language === "javascript" || language === "typescript"
      ? header([...nodeSetupSteps(pm), ...(lint ? [`      - run: ${c.lint}`] : []), `      - run: ${c.test}`])
      : QUALITY_BY_LANGUAGE[language];
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
  `      - uses: ${PINNED_ACTIONS.checkout}`,
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
// `npm pack`/`npm install <tarball>` need no lockfile, so only the dependency
// install step is package-manager-aware.
export const packSmokeWorkflow = (pm = "npm") =>
  [
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
    `      - uses: ${PINNED_ACTIONS.checkout}`,
    ...nodeSetupSteps(pm),
    "      - name: Pack and install the tarball clean",
    "        run: |",
    "          tgz=$(npm pack --silent)",
    "          dir=$(mktemp -d)",
    '          npm install --prefix "$dir" "$PWD/$tgz" --no-audit --no-fund',
    '          echo "Tarball installs clean: $tgz"',
  ].join("\n");

// Opt-in nightly/manual mutation audit (KJC-TSK-0589). NEVER a PR gate: it runs
// on a weekly schedule + manual dispatch, and the mutate step is non-blocking
// (continue-on-error) so a red run never nags. Only stacks whose `kj mutate`
// yields a JSON report (stryker/mutmut/infection) get a workflow — no silent
// scaffold for tools that can't report yet.
const MUTATION_TOOLCHAIN = {
  javascript: "node", // resolved per package manager in mutationWorkflowFor
  python: [
    `      - uses: ${PINNED_ACTIONS.setupPython}`,
    "        with:",
    "          python-version: '3.12'",
    "      - run: pip install mutmut pytest",
  ],
  php: [
    `      - uses: ${PINNED_ACTIONS.setupPhp}`,
    "        with:",
    "          php-version: '8.3'",
    "      - run: composer install --no-interaction --no-progress",
  ],
};
MUTATION_TOOLCHAIN.typescript = MUTATION_TOOLCHAIN.javascript;

/** Opt-in mutation workflow entry, or null for a stack without a JSON report. */
export function mutationWorkflowFor(language, pm = "npm") {
  const entry = MUTATION_TOOLCHAIN[language];
  if (!entry) return null;
  const c = PM_COMMANDS[pm] || PM_COMMANDS.npm;
  const toolchain = entry === "node" ? [...c.setup, `      - run: ${c.install}`] : entry;
  const body = [
    "name: Mutation (nightly)",
    "on:",
    "  schedule:",
    "    - cron: '0 4 * * 1'",
    "  workflow_dispatch:",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  mutation:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - uses: ${PINNED_ACTIONS.checkout}`,
    "        with:",
    "          fetch-depth: 0",
    `      - uses: ${PINNED_ACTIONS.setupNode}`,
    "        with:",
    "          node-version: 22",
    ...toolchain,
    "      - name: Mutation testing (advisory, never blocks a PR)",
    "        continue-on-error: true",
    "        run: npx --yes --package karajan-code kj mutate --since HEAD~1",
  ].join("\n");
  return { file: "kj-mutation.yml", blockId: "wf-mutation", body };
}

/** Conditional workflows: shrink-budget on strict, pack-smoke when publishable. */
export function extraWorkflowsFor({ profile = "standard", publishable = false, pm = "npm" } = {}) {
  const extras = [];
  if (profile === "strict") {
    extras.push({ file: "kj-shrink-budget.yml", blockId: "wf-shrink", body: SHRINK_BUDGET_WORKFLOW });
  }
  if (publishable) {
    extras.push({ file: "kj-pack-smoke.yml", blockId: "wf-pack-smoke", body: packSmokeWorkflow(pm) });
  }
  return extras;
}
