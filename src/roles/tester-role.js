import { AgentRole } from "./agent-role.js";
import { extractFirstJson } from "../utils/json-extract.js";
import { detectTestFramework } from "../utils/project-detect.js";

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
  "dart-test": "dart test 2>&1"
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
  "dart-test": "dart test 2>&1"
};

export class TesterRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "tester" });
  }

  extractInput(input) {
    if (typeof input === "string") return { task: input, diff: null, sonarIssues: null };
    return {
      task: input?.task || this.context?.task || "",
      diff: input?.diff || null,
      sonarIssues: input?.sonarIssues || null,
      onOutput: input?.onOutput || null
    };
  }

  async buildPrompt({ task, diff, sonarIssues }) {
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
      sections.push(
        `## Detected test framework: ${detection.framework} (${detection.language})`,
        "**Step 0**: If node_modules/ does not exist, run `npm install` (or `pnpm install`) first.",
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

    sections.push(
      "",
      "Return ONLY a single valid JSON object:",
      '{"tests_pass":boolean,"coverage":{"overall":number,"services":number,"utilities":number},"missing_scenarios":[string],"quality_issues":[string],"verdict":"pass"|"fail"}',
      "",
      "- coverage.overall MUST be a real number from the test runner output, NOT an estimate",
      "- If coverage tool is not available, set coverage.overall to null (not 0, not a guess)",
      "- tests_pass must reflect whether the actual test run succeeded",
      `## Task\n${task}`
    );
    if (diff) sections.push(`## Git diff\n${diff}`);
    if (sonarIssues) sections.push(`## Sonar test issues\n${sonarIssues}`);
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
    return `Verdict: ${verdict}; Coverage: ${coverageStr}${missingPart}${qualityPart}`;
  }
}
