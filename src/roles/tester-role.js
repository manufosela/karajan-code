import { AgentRole } from "./agent-role.js";
import { extractFirstJson } from "../utils/json-extract.js";
import { detectTestFramework } from "../utils/project-detect.js";
import { loadAvailableSkills, buildSkillSection } from "../skills/skill-loader.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on evaluating test quality."
].join(" ");

/**
 * Map test framework to the command that runs tests with coverage.
 */
const COVERAGE_COMMANDS = {
  vitest: "npx vitest run --coverage --reporter=verbose 2>&1",
  jest: "npx jest --coverage --verbose 2>&1",
  mocha: "npx c8 mocha 2>&1",
  playwright: "npx playwright test 2>&1",
  pytest: "pytest --cov --tb=short 2>&1",
  "go-test": "go test -cover -v ./... 2>&1",
  "cargo-test": "cargo test --verbose 2>&1",
  junit: "mvn test 2>&1",
  rspec: "bundle exec rspec 2>&1",
  phpunit: "vendor/bin/phpunit --coverage-text 2>&1",
  "dotnet-test": "dotnet test --collect:\"XPlat Code Coverage\" 2>&1",
  "dart-test": "dart test 2>&1",
  // INF-B: the basic suite ALWAYS runs first; checkov is the additive deep
  // scan. If checkov is missing this chain fails and the brief falls back to
  // the basic suite alone (declared degradation, never green-by-omission).
  "terraform-validate": "terraform init -backend=false -input=false 2>&1 && terraform validate 2>&1 && checkov -d . --compact --quiet 2>&1",
  "helm-lint": "helm lint . 2>&1 && checkov -d . --compact --quiet 2>&1",
  "kustomize-build": "kustomize build . > /dev/null && checkov -d . --compact --quiet 2>&1",
  "ansible-lint": "ansible-lint 2>&1 && checkov -d . --compact --quiet 2>&1"
};

const TEST_COMMANDS = {
  vitest: "npx vitest run --reporter=verbose 2>&1",
  jest: "npx jest --verbose 2>&1",
  mocha: "npx mocha 2>&1",
  playwright: "npx playwright test 2>&1",
  pytest: "pytest --tb=short 2>&1",
  "go-test": "go test -v ./... 2>&1",
  "cargo-test": "cargo test --verbose 2>&1",
  junit: "mvn test 2>&1",
  rspec: "bundle exec rspec 2>&1",
  phpunit: "vendor/bin/phpunit 2>&1",
  "dotnet-test": "dotnet test 2>&1",
  "dart-test": "dart test 2>&1",
  // INF-B (KJC-TSK-0759): infra suites — validity IS the test floor.
  "terraform-validate": "terraform init -backend=false -input=false 2>&1 && terraform validate 2>&1",
  "helm-lint": "helm lint . 2>&1",
  "kustomize-build": "kustomize build . > /dev/null && echo kustomize build: OK",
  "ansible-lint": "ansible-lint 2>&1"
};

export class TesterRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "tester" });
  }

  extractInput(input) {
    if (typeof input === "string") return { task: input, diff: null, sonarIssues: null, pendingGherkinTests: null, shellTestResults: null };
    return {
      task: input?.task || this.context?.task || "",
      diff: input?.diff || null,
      sonarIssues: input?.sonarIssues || null,
      // Tests-first Phase 3 (v2.7.5): the tester now has two extra inputs.
      //   - pendingGherkinTests: HU-declared Gherkin scenarios that need
      //     translation into executable code tests in the project's
      //     framework. The tester writes the test files and includes them
      //     in the suite run before computing verdict.
      //   - shellTestResults: results of running the HU's shell-type
      //     acceptance_tests (already run upstream, passed at this point).
      //     Passed for context so the tester doesn't re-run them redundantly.
      pendingGherkinTests: input?.pendingGherkinTests || null,
      shellTestResults: input?.shellTestResults || null,
      onOutput: input?.onOutput || null
    };
  }

  async buildPrompt({ task, diff, sonarIssues, pendingGherkinTests, shellTestResults }) {
    const projectDir = this.config?.projectDir || process.cwd();
    const detection = await detectTestFramework(projectDir);

    const sections = [SUBAGENT_PREAMBLE];
    if (this.instructions) sections.push(this.instructions);

    sections.push(
      "You are a test quality gate. Your job is to EXECUTE the test suite, measure REAL coverage, and evaluate quality.",
      "You MUST run the actual test command — do NOT guess or estimate results."
    );

    if (detection.hasTests && detection.framework) {
      const coverageCmd = COVERAGE_COMMANDS[detection.framework];
      const testCmd = TEST_COMMANDS[detection.framework];
      // INF-B: infra suites have no node_modules — the step-0 contract is
      // "the tool exists or you SAY which one is missing", never a fake green.
      const step0 = detection.language === "infra"
        ? "**Step 0**: Verify the SUITE tool is installed (`which terraform`/`helm`/`kustomize`/`ansible-lint`). If the suite tool is MISSING, do NOT fake a green: report it in `failures` with the exact install command and set tests_pass: false. `checkov` (the deep scan below) is OPTIONAL: if it is missing, run the basic suite as the fallback and SAY the deep scan was skipped (degraded, never green-by-omission)."
        : "**Step 0**: If node_modules/ does not exist, run `npm install` (or `pnpm install`) first.";
      sections.push(
        `## Detected test framework: ${detection.framework} (${detection.language})`,
        step0,
        `**Step 1**: Run the test suite with coverage:`,
        "```bash",
        coverageCmd || testCmd,
        "```",
        "If the coverage command fails (missing dependency), fall back to:",
        "```bash",
        testCmd,
        "```",
        "**Step 2**: Parse the output to extract: pass/fail count, coverage percentages, any failures.",
        "**Step 3**: Return a single JSON object with REAL numbers from the test output."
      );
    } else {
      sections.push(
        "## No test framework detected",
        "**Step 0**: If package.json exists but node_modules/ does not, run `npm install` first.",
        "**Step 1**: Look at package.json or project files to find test scripts.",
        "**Step 2**: Try running `npm test` or detect the framework from config files.",
        "**Step 3**: If tests exist, run them. If no tests exist, report tests_pass: false with verdict: 'fail'.",
        "**Step 4**: Return a JSON object with your findings."
      );
    }

    // Tests-first Phase 3 (v2.7.5): include the upstream shell-test results
    // so the tester knows which part of the contract is already green.
    if (Array.isArray(shellTestResults) && shellTestResults.length > 0) {
      const passedCount = shellTestResults.filter((r) => r.passed).length;
      sections.push(
        "## Acceptance gate — shell tests",
        `The HU's shell-type acceptance_tests already ran upstream: ${passedCount}/${shellTestResults.length} passed.`,
        "Do NOT re-run them. Use the coverage/translation steps below to decide your verdict."
      );
    }

    // Gherkin translation block — only when the HU carries Gherkin
    // scenarios. Tester must produce real test files (in the detected
    // framework's language) that encode Given/When/Then. This is how
    // behaviour-level specs become enforceable.
    if (Array.isArray(pendingGherkinTests) && pendingGherkinTests.length > 0) {
      sections.push(
        "## Gherkin acceptance tests to translate",
        "These Gherkin scenarios are the HU's behavioural contract. They are NOT yet",
        "executable — your job is to turn each one into a concrete test case in the",
        "project's test framework, WRITE the test files, and INCLUDE them in the suite",
        "run that determines your verdict.",
        "",
        "For each scenario below:",
        "1. Pick the appropriate test file (use `target` hint if present; otherwise",
        "   put the test next to the module it exercises).",
        "2. Write a test that asserts the Given/When/Then as-is. Do NOT soften the",
        "   assertion — if it's ambiguous, pick the stricter reading.",
        "3. Make sure the test runs as part of the normal suite (no separate invocation).",
        "",
        "If ANY translated test fails on the current code, return verdict: \"fail\" with",
        "a failing_scenarios array listing the scenarios that didn't pass. The coder",
        "will iterate.",
        ""
      );
      pendingGherkinTests.forEach((entry, i) => {
        const content = typeof entry === "string" ? entry : entry?.content || "";
        const target = entry && entry.file ? ` · target: \`${entry.file}\`` : "";
        sections.push(
          `### Scenario ${i + 1}${target}`,
          "```gherkin",
          content,
          "```",
          ""
        );
      });
    }

    sections.push(
      "",
      "Return ONLY a single valid JSON object:",
      '{"tests_pass":boolean,"coverage":{"overall":number,"services":number,"utilities":number},"missing_scenarios":[string],"quality_issues":[string],"failing_scenarios":[string],"translated_scenarios":[string],"verdict":"pass"|"fail"}',
      "",
      "- coverage.overall MUST be a real number from the test runner output, NOT an estimate",
      "- If coverage tool is not available, set coverage.overall to null (not 0, not a guess)",
      "- tests_pass must reflect whether the actual test run succeeded",
      "- failing_scenarios: when Gherkin was given, list the scenarios your translated tests CAUGHT as failing",
      "- translated_scenarios: when Gherkin was given, list the scenarios you successfully turned into passing tests",
      "- verdict MUST be \"fail\" if any translated scenario still fails (even if coverage is green)",
      `## Task\n${task}`
    );
    if (diff) sections.push(`## Git diff\n${diff}`);
    if (sonarIssues) sections.push(`## Sonar test issues\n${sonarIssues}`);

    // Inject test-relevant skills (filtered by role=tester to only include
    // testing patterns like pytest-patterns, vitest-patterns, etc.)
    const skills = await loadAvailableSkills(projectDir);
    const skillSection = buildSkillSection(skills, {
      provider: this._resolvedProvider || (typeof this.resolveProvider === "function" ? this.resolveProvider() : null),
      role: "tester",
    });
    if (skillSection) sections.push(skillSection);

    return { prompt: sections.join("\n\n") };
  }

  parseOutput(raw) { return extractFirstJson(raw); }

  isSuccessful(parsed) {
    const verdict = parsed.verdict || (parsed.tests_pass ? "pass" : "fail");
    return verdict === "pass";
  }

  buildSuccessResult(parsed, provider) {
    const verdict = parsed.verdict || (parsed.tests_pass ? "pass" : "fail");
    return {
      tests_pass: Boolean(parsed.tests_pass),
      coverage: parsed.coverage || {},
      missing_scenarios: parsed.missing_scenarios || [],
      quality_issues: parsed.quality_issues || [],
      // Tests-first Phase 3: Gherkin translation outcomes.
      failing_scenarios: Array.isArray(parsed.failing_scenarios) ? parsed.failing_scenarios : [],
      translated_scenarios: Array.isArray(parsed.translated_scenarios) ? parsed.translated_scenarios : [],
      verdict,
      provider
    };
  }

  buildSummary(parsed) {
    const verdict = parsed.verdict || (parsed.tests_pass ? "pass" : "fail");
    const coverage = parsed.coverage || {};
    const coverageStr = coverage.overall != null ? `${coverage.overall}%` : "not measured";
    const missingPart = parsed.missing_scenarios?.length ? `; ${parsed.missing_scenarios.length} missing scenario(s)` : "";
    const qualityPart = parsed.quality_issues?.length ? `; ${parsed.quality_issues.length} quality issue(s)` : "";
    const failingPart = parsed.failing_scenarios?.length ? `; ${parsed.failing_scenarios.length} failing scenario(s)` : "";
    const translatedPart = parsed.translated_scenarios?.length ? `; ${parsed.translated_scenarios.length} scenario(s) translated` : "";
    return `Verdict: ${verdict}; Coverage: ${coverageStr}${translatedPart}${failingPart}${missingPart}${qualityPart}`;
  }
}
