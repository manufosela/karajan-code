/**
 * CI workflow templates for `kj harden` (KJC-TSK-0557).
 *
 * Generic, language-agnostic GitHub Actions that `kj harden` seeds into a
 * target repo's `.github/workflows/`. Bodies are plain strings (NOT template
 * literals) so the `${{ … }}` GitHub expressions survive verbatim.
 */
import { AI_ATTRIBUTION } from "./hook-templates.js";

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
  setupPhp: "shivammathur/setup-php@eb7c497e18156a6bbabfef1d3a82760b9eda3962 # v2",
  setupJava: "actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3 # v4",
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
  "      - name: Scan commit messages and PR body for AI attribution",
  "        env:",
  "          BASE_REF: ${{ github.base_ref }}",
  // KJC-BUG-0164: el cuerpo de la PR tambien es superficie — 15 PRs entraron
  // con pie de atribucion porque solo se escaneaban commits. Via env, jamas
  // interpolado en el script (el cuerpo es texto no confiable).
  "          PR_BODY: ${{ github.event.pull_request.body }}",
  "          PR_TITLE: ${{ github.event.pull_request.title }}",
  "        run: |",
  '          if ! msgs=$(git log --format=%B "origin/${BASE_REF}...HEAD"); then',
  '            echo "::error::cannot resolve origin/${BASE_REF}...HEAD — the scan did not run"; exit 1',
  "          fi",
  // KJC-BUG-0503: the same list the local hooks and kj review judge with.
  `          pat='${AI_ATTRIBUTION}'`,
  '          if printf "%s" "$msgs" | grep -qiE "$pat"; then',
  '            echo "::error::AI attribution detected in commit messages"; exit 1',
  "          fi",
  '          if printf "%s\\n%s" "$PR_BODY" "$PR_TITLE" | grep -qiE "$pat|generated with \\[?claude|🤖"; then',
  '            echo "::error::AI attribution detected in the PR body or title"; exit 1',
  "          fi",
  '          echo "AI attribution scan: clean"',
].join("\n");

// HU-3531: the templates carry `branches: [main]`; the engine swaps in the repo's base branch.
// Only `main` stays bare (it renders byte for byte as before); every other name is single-quoted,
// because YAML would read bare 123, true, null or ~ as a number, boolean or null, not a string.
// A control character or ": " would end the scalar or open a mapping: refused, never injected.
export function onBaseBranch(body, baseBranch) {
  if (typeof baseBranch !== "string" || baseBranch === "" || /[\x00-\x1f\x7f]|: /.test(baseBranch)) {
    throw new Error(`kj harden: ${JSON.stringify(baseBranch)} is not a safe base branch name for the generated workflows`);
  }
  const scalar = baseBranch === "main" ? baseBranch : `'${baseBranch.replaceAll("'", "''")}'`;
  return body.replaceAll("    branches: [main]", () => `    branches: [${scalar}]`);
}
/** Universal workflows (every stack). style:hash ⇒ marker in YAML comments. */
export const WORKFLOWS = [
  { file: "kj-no-ai-attribution.yml", blockId: "wf-no-ai", body: NO_AI_ATTRIBUTION_WORKFLOW },
];

// The judge: a repo that ships kj itself (bin/kj.js on the base branch) judges with the
// base's kj, checked out apart; any other with the pinned published kj, installed apart.
const judgeLines = (kjVersion, kjName) => [
  '          if git cat-file -e "origin/${BASE_REF}:bin/kj.js" 2>/dev/null; then',
  '            git worktree add --detach "$JUDGE" "origin/${BASE_REF}"',
  '            (cd "$JUDGE" && npm ci --ignore-scripts)',
  '            KJ="node $JUDGE/bin/kj.js"',
  "          else",
  '            mkdir -p "$JUDGE"',
  `            (cd "$JUDGE" && echo '{"private":true}' > package.json && npm install --no-save --ignore-scripts --no-audit --no-fund ${kjName}@${kjVersion})`,
  `            KJ="node $JUDGE/node_modules/${kjName}/bin/kj.js"`,
  "          fi",
];

// PL-C (KJC-TSK-0735) — tier C del ADR 0001: re-check merge-blocking en CI
// (cubre el hook local manipulado). Solo se siembra con policy declarada;
// npx PINEADO a la versión del kj que corrió harden — jamás @latest en CI.
// KJC-BUG-0399: the judge is never the PR's code. A repo that ships kj itself
// judges with the kj of the BASE branch, checked out apart; the PR is only data.
// KJC-BUG-0419: on `pull_request` GitHub runs the PR's own copy of this YAML, so a
// PR could rewrite its judge. `pull_request_target` runs the base's YAML; the PR
// is fetched into its own worktree, read by kj and never installed nor executed.
export const policyWorkflowFor = (kjVersion, kjName = "karajan-code") => [
  "name: Policy",
  "on:",
  "  pull_request_target:",
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
  "          PR_NUMBER: ${{ github.event.pull_request.number }}",
  "        run: |",
  '          JUDGE="$RUNNER_TEMP/kj-judge"',
  '          PR_TREE="$RUNNER_TEMP/kj-pr"',
  '          git fetch --no-tags origin "${BASE_REF}:refs/remotes/origin/${BASE_REF}"',
  '          git fetch --no-tags origin "+refs/pull/${PR_NUMBER}/head:refs/remotes/origin/kj-pr-head"',
  ...judgeLines(kjVersion, kjName),
  '          git worktree add --detach "$PR_TREE" origin/kj-pr-head',
  '          cd "$PR_TREE"',
  '          $KJ policy check --range "origin/${BASE_REF}...HEAD" --strict',
].join("\n");

// HU-4012: every PR commit carries its published cross-AI verdict (kj review --publish-pr);
// a commit made with --no-verify skipped the review and this check names it. The verdict is
// published as a PR review, so a submitted review reruns it. The PR is only data.
export const verdictsWorkflowFor = (kjVersion, kjName = "karajan-code") => [
  "name: Cross-AI verdicts",
  "on:",
  "  pull_request:",
  "    types: [opened, synchronize, reopened]",
  "  pull_request_review:",
  "    types: [submitted]",
  "permissions:",
  "  contents: read",
  "  pull-requests: read",
  "jobs:",
  "  verdicts:",
  // Forks and bots hold no kj verdicts to publish: the check is for the team's own branches.
  "    if: github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.type != 'Bot'",
  "    runs-on: ubuntu-latest",
  "    steps:",
  `      - uses: ${PINNED_ACTIONS.checkout}`,
  "        with:",
  "          fetch-depth: 0",
  `      - uses: ${PINNED_ACTIONS.setupNode}`,
  "        with:",
  "          node-version: 22",
  "      - name: Every commit has its published cross-AI verdict",
  "        env:",
  // Set on pull_request and pull_request_review alike (github.base_ref is empty on a review).
  "          BASE_REF: ${{ github.event.pull_request.base.ref }}",
  "          PR: ${{ github.event.pull_request.number }}",
  "          GH_TOKEN: ${{ github.token }}",
  "        run: |",
  '          JUDGE="$RUNNER_TEMP/kj-judge"',
  '          git fetch --no-tags origin "${BASE_REF}:refs/remotes/origin/${BASE_REF}"',
  ...judgeLines(kjVersion, kjName),
  '          $KJ review --verify-pr "$PR"',
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
  npm: { setup: [], install: "npm ci", run: "npm run -s", lint: "npm run -s lint", test: "npm test" },
  pnpm: {
    setup: ["      - run: corepack enable"],
    install: "pnpm install --frozen-lockfile",
    run: "pnpm run -s",
    lint: "pnpm run -s lint",
    test: "pnpm test",
  },
  yarn: {
    setup: ["      - run: corepack enable"],
    install: "yarn install --frozen-lockfile",
    run: "yarn run", // yarn's own runner (Plug'n'Play), bare like the hooks': Yarn 2+ rejects -s
    lint: "npm run -s lint",
    test: "yarn test",
  },
};

// KJC-BUG-0529: the engine decides the Node version; this only renders it.
function nodeVersionLine(nodeVersion) {
  if (nodeVersion?.file) {
    if (!/^(?:[\w.-]+\/)*(?:\.nvmrc|\.node-version|package\.json)$/.test(nodeVersion.file)) throw new Error(`kj harden: "${nodeVersion.file}" is not a Node version file`);
    return `          node-version-file: ${nodeVersion.file}`;
  }
  if (nodeVersion?.version && !/^[0-9][0-9.x]*$/.test(nodeVersion.version)) throw new Error(`kj harden: "${nodeVersion.version}" is not a Node version`);
  return `          node-version: ${nodeVersion?.version ?? 22}`;
}

// "test" runs the pm's test command, another script runs through the pm, null runs nothing.
const testStep = (c, testScript) => {
  if (testScript === null) return [];
  const command = testScript === "test" ? c.test : `${c.run} ${testScript}`;
  return [`      - run: ${command}`];
};

const nodeSetupSteps = (pm, nodeVersion = null) => [
  `      - uses: ${PINNED_ACTIONS.setupNode}`,
  "        with:",
  nodeVersionLine(nodeVersion),
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
};

// KJC-BUG-0529 (#3661, part 2): the engine decides the PHP version; this validates and renders it.
function phpQualityBody(phpVersion = null) {
  const version = phpVersion ?? "8.3";
  if (!/^\d+\.\d+$/.test(version)) throw new Error(`kj harden: "${version}" is not a PHP version`);
  return header([
    `      - uses: ${PINNED_ACTIONS.setupPhp}`,
    "        with:",
    `          php-version: '${version}'`,
    "      - run: composer install --no-interaction --no-progress",
    "      - run: vendor/bin/phpstan analyse --no-progress",
    "      - run: vendor/bin/phpunit",
  ]);
}

// HU-4037: the engine reads the Java toolchain and the commands from the build; this validates and renders them.
function gradleQualityBody({ javaVersion = null, lint = null, test = null } = {}) {
  const version = javaVersion ?? "17";
  if (!/^\d+$/.test(version)) throw new Error(`kj harden: "${version}" is not a Java version`);
  const runs = [lint, test].filter(Boolean);
  if (runs.length === 0) return null;
  return header([
    `      - uses: ${PINNED_ACTIONS.setupJava}`,
    "        with:",
    "          distribution: temurin",
    `          java-version: "${version}"`,
    "          cache: gradle",
    ...runs.map((command) => `      - run: ${command}`),
  ]);
}
/**
 * Stack-aware Quality workflow entry, or null for an unknown language.
 * `lint:false` drops the JS lint step entirely (project has no lint script,
 * KJC-BUG-0137) — mirroring the local hook, which also omits it.
 */
export function qualityWorkflowFor(language, pm = "npm", lint = true, root = ".", { nodeVersion = null, testScript = "test", phpVersion = null, gradle = null } = {}) {
  const c = PM_COMMANDS[pm] || PM_COMMANDS.npm;
  let body = QUALITY_BY_LANGUAGE[language];
  if (language === "javascript" || language === "typescript") {
    body = header([...nodeSetupSteps(pm, nodeVersion), ...(lint ? [`      - run: ${c.lint}`] : []), ...testStep(c, testScript)]);
  } else if (language === "php") {
    body = phpQualityBody(phpVersion);
  } else if (language === "gradle") {
    body = gradleQualityBody(gradle ?? {});
  }
  return body ? { file: "kj-quality.yml", blockId: "wf-quality", body: inRoot(body, root) } : null;
}

const JOBS_LINE = "jobs:\n  quality:\n";

// `base`, then `base-2`, `base-3`… until one is free: two roots never share a job key.
function freeJobId(base, taken) {
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

/**
 * HU-4049: several stack roots share one kj-quality.yml, one job per root, each
 * built by qualityWorkflowFor for that root (which already checked the dir) and
 * named after its dir so its required check says which root it judges.
 */
export function multiRootQualityWorkflow(perRoot) {
  const ids = new Set();
  const jobs = perRoot.map(({ root, wf }) => {
    const id = freeJobId(`quality-${root === "." ? "root" : root.replaceAll(/[^\w-]/g, "-")}`, ids);
    ids.add(id);
    return `  ${id}:\n    name: quality (${root})\n${wf.body.slice(wf.body.indexOf(JOBS_LINE) + JOBS_LINE.length)}`;
  });
  const first = perRoot[0].wf.body;
  return { file: "kj-quality.yml", blockId: "wf-quality", body: `${first.slice(0, first.indexOf(JOBS_LINE))}jobs:\n${jobs.join("\n")}` };
}

// KJC-BUG-0309 (#2023): a repo whose app lives in a subdirectory runs every step
// there. The root goes into YAML, so it is a plain relative path or nothing.
function inRoot(body, root) {
  if (root === "." || root === "") return body;
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(root) || root.split("/").includes("..")) throw new Error(`kj harden: "${root}" is not a safe directory for the Quality workflow`);
  return body.replace("    runs-on: ubuntu-latest\n", `    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: ${root}\n`);
}

// Caps the net LOC delta of a PR (strict profile only — it is opinionated).
// KJC-TSK-1492 (KJC-BUG-0519): counted by the kj that ran harden, with kj's own budget
// (loc-budget.js), not with a list of exclusions copied into the YAML.
export const shrinkBudgetWorkflowFor = (kjVersion, kjName = "karajan-code") => [
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
  `      - uses: ${PINNED_ACTIONS.setupNode}`,
  "        with:",
  "          node-version: 22",
  "      - name: Net LOC delta within budget",
  "        env:",
  "          BASE_REF: ${{ github.base_ref }}",
  "        run: |",
  // The counter is installed apart and never from the PR: the PR is only the tree it measures.
  '          JUDGE="$RUNNER_TEMP/kj-size"',
  '          mkdir -p "$JUDGE"',
  `          (cd "$JUDGE" && echo '{"private":true}' > package.json && npm install --no-save --ignore-scripts --no-audit --no-fund ${kjName}@${kjVersion})`,
  `          node "$JUDGE/node_modules/${kjName}/bin/kj.js" pr-size --base "$BASE_REF" --limit "$LOC_LIMIT"`,
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
    '    - cron: "0 4 * * 1"',
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

// STW-E (KJC-TSK-0793): the scheduled Steward sweep — OPT-IN via
// steward.action: true. Decay happens precisely on the days nobody looks, so
// the watcher cannot live inside a session: the Action runs where the repo
// lives, publishes the SAME report file every other mode writes (one source
// of truth), and a broken invariant never stops the report from publishing.
export function stewardWorkflowFor(kjVersion, pkgName = "karajan-code") {
  return [
    "name: Steward sweep",
    "on:",
    "  schedule:",
    '    - cron: "17 6 * * 1"',
    "  workflow_dispatch: {}",
    "permissions:",
    "  contents: write",
    "jobs:",
    "  sweep:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - uses: ${PINNED_ACTIONS.checkout}`,
    `      - uses: ${PINNED_ACTIONS.setupNode}`,
    "        with:",
    '          node-version: "22"',
    `      - run: npm install -g ${pkgName}@${kjVersion}`,
    "      - name: Sweep (a broken invariant must not stop the report)",
    "        env:",
    "          GH_TOKEN: ${{ github.token }}",
    "        run: kj steward sweep || true",
    "      - name: Publish the report and the proposed cards",
    "        run: |",
    "          git add .karajan/steward .karajan/plans 2>/dev/null || true",
    '          git diff --cached --quiet || { git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -m "chore(steward): sweep report [skip ci]" && git push; }',
  ].join("\n");
}

/** Conditional workflows: shrink-budget on strict, pack-smoke when publishable. */
export function extraWorkflowsFor({ profile = "standard", publishable = false, pm = "npm", kjVersion, kjName } = {}) {
  const extras = [];
  if (profile === "strict") {
    extras.push({ file: "kj-shrink-budget.yml", blockId: "wf-shrink", body: shrinkBudgetWorkflowFor(kjVersion, kjName) });
  }
  if (publishable) {
    extras.push({ file: "kj-pack-smoke.yml", blockId: "wf-pack-smoke", body: packSmokeWorkflow(pm) });
  }
  return extras;
}
