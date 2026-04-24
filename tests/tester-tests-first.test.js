import { describe, expect, it, vi } from "vitest";
import { TesterRole } from "../src/roles/tester-role.js";

// Tests-first Phase 3 (v2.7.5): the tester role:
//  - knows the upstream shell-test results so it doesn't re-run them,
//  - receives pending Gherkin scenarios and is told to translate +
//    run + report per-scenario verdicts.

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

async function build(input) {
  const role = new TesterRole({
    config: {
      projectDir: process.cwd(),
      roles: { tester: { provider: "claude" } },
      coder: "claude",
    },
    logger,
    emitter: { emit: vi.fn() },
  });
  await role.init({ task: input.task || "something" });
  return role.buildPrompt(input);
}

describe("TesterRole.buildPrompt — Gherkin translation block", () => {
  it("does not mention Gherkin when no pending scenarios are passed", async () => {
    const { prompt } = await build({ task: "t", diff: null, sonarIssues: null, pendingGherkinTests: null });
    expect(prompt).not.toMatch(/Gherkin acceptance tests to translate/);
  });

  it("emits the translation block when pending Gherkin scenarios are present", async () => {
    const { prompt } = await build({
      task: "implement login",
      pendingGherkinTests: [
        { type: "gherkin", content: "Given a logged-out user\nWhen they POST /login\nThen 200 response" },
        { type: "gherkin", content: "Given expired session\nWhen they navigate to /dashboard\nThen redirect to /login", file: "tests/session.test.ts" },
      ],
    });
    expect(prompt).toMatch(/## Gherkin acceptance tests to translate/);
    expect(prompt).toMatch(/### Scenario 1/);
    expect(prompt).toMatch(/### Scenario 2 · target: `tests\/session\.test\.ts`/);
    expect(prompt).toMatch(/Given a logged-out user/);
    expect(prompt).toMatch(/redirect to \/login/);
  });

  it("mentions shell-test results when provided so the tester does not re-run them", async () => {
    const { prompt } = await build({
      task: "t",
      shellTestResults: [
        { cmd: "echo ok", passed: true, type: "shell" },
        { cmd: "true", passed: true, type: "shell" },
      ],
    });
    expect(prompt).toMatch(/## Acceptance gate — shell tests/);
    expect(prompt).toMatch(/2\/2 passed/);
    expect(prompt).toMatch(/Do NOT re-run them/);
  });

  it("extends the JSON schema with failing_scenarios and translated_scenarios", async () => {
    const { prompt } = await build({
      task: "t",
      pendingGherkinTests: [{ type: "gherkin", content: "G1" }],
    });
    expect(prompt).toMatch(/failing_scenarios/);
    expect(prompt).toMatch(/translated_scenarios/);
    expect(prompt).toMatch(/verdict MUST be "fail" if any translated scenario still fails/);
  });
});

describe("TesterRole — result and summary", () => {
  it("parses translated/failing scenarios into the success result", () => {
    const role = new TesterRole({
      config: { projectDir: process.cwd(), roles: { tester: { provider: "claude" } }, coder: "claude" },
      logger,
      emitter: { emit: vi.fn() },
    });
    const parsed = {
      tests_pass: true,
      coverage: { overall: 88 },
      missing_scenarios: [],
      quality_issues: [],
      translated_scenarios: ["Logged out redirects", "Session expires"],
      failing_scenarios: [],
      verdict: "pass",
    };
    const out = role.buildSuccessResult(parsed, "claude");
    expect(out.translated_scenarios).toEqual(["Logged out redirects", "Session expires"]);
    expect(out.failing_scenarios).toEqual([]);
  });

  it("includes translated and failing counts in the summary line", () => {
    const role = new TesterRole({
      config: { projectDir: process.cwd(), roles: { tester: { provider: "claude" } }, coder: "claude" },
      logger,
      emitter: { emit: vi.fn() },
    });
    const summary = role.buildSummary({
      tests_pass: false,
      coverage: { overall: 62 },
      translated_scenarios: ["A"],
      failing_scenarios: ["B", "C"],
      verdict: "fail",
    });
    expect(summary).toMatch(/Verdict: fail/);
    expect(summary).toMatch(/1 scenario\(s\) translated/);
    expect(summary).toMatch(/2 failing scenario\(s\)/);
  });
});
