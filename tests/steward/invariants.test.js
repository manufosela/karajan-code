// STW-A PR-A (KJC-TSK-0789, epic KJC-PCS-0081) — the verdict kernel. An
// invariant answers ONE of four things: ok / broken / unknown (evidence
// expired → refresh) / not-observable (nowhere to look → instrument).
// Confusing the last two with ok is the false green the Steward exists for:
// in GREBLA the workflows run ONLY on pull_request, main has not one run of
// its own, and "how long has main been red" had no possible answer.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VERDICTS, resolveFreshness, evaluateMainCi, evaluateSecurityAudit, evaluateVulnAging, evaluateDeadCodeTrend, evaluateCoverageConfig, evaluatePhantomCoverage, runInvariants } from "../../src/steward/invariants.js";
const repoWith = (workflows) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-steward-"));
  if (workflows) {
    fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
    for (const [name, body] of Object.entries(workflows)) fs.writeFileSync(path.join(dir, ".github", "workflows", name), body);
  }
  return dir;
};
const COVERAGE_CI = { "ci.yml": "jobs:\n  t:\n    steps:\n      - run: npx vitest run --coverage\n" };
const DAY = 86_400_000;
const now = Date.parse("2026-08-27T12:00:00Z");
describe("resolveFreshness — AC8: defaults are applied AND said", () => {
  it("without a project declaration, the calibrated defaults apply and are reported as such", () => {
    const r = resolveFreshness({});
    expect(r.declared).toBe(false);
    expect(r.values.main_ci_red_days).toBe(3); // GREBLA: 21 days of red E2E hid a 17-day production bug
    expect(r.values.security_audit_days).toBe(14);
  });
  it("a declared value wins, the rest stay default — and declared says so", () => {
    const r = resolveFreshness({ steward: { freshness: { main_ci_red_days: 1 } } });
    expect(r.declared).toBe(true);
    expect(r.values.main_ci_red_days).toBe(1);
    expect(r.values.security_audit_days).toBe(14);
  });
});
describe("main-ci — invariant #1", () => {
  it("workflows that only fire on pull_request: NOT OBSERVABLE, remedy says instrument", () => {
    const dir = repoWith({ "ci.yml": "name: CI\non:\n  pull_request:\n    branches: [main]\njobs: {}\n" });
    const r = evaluateMainCi({ projectDir: dir, baseBranch: "main" });
    expect(r.verdict).toBe(VERDICTS.NOT_OBSERVABLE);
    expect(r.remedy).toMatch(/push/);
  });
  it("no workflows at all: NOT OBSERVABLE too — never ok by absence", () => {
    expect(evaluateMainCi({ projectDir: repoWith(null), baseBranch: "main" }).verdict).toBe(VERDICTS.NOT_OBSERVABLE);
  });
  it("instrumented but the runs cannot be read: UNKNOWN with a refresh remedy — never ok", () => {
    const dir = repoWith({ "ci.yml": "name: CI\non:\n  push:\n    branches: [main]\njobs: {}\n" });
    const r = evaluateMainCi({ projectDir: dir, baseBranch: "main", runsFn: () => { throw new Error("no gh"); } });
    expect(r.verdict).toBe(VERDICTS.UNKNOWN);
    expect(r.remedy).toMatch(/refresh|gh/i);
  });
  it("red beyond the freshness window: BROKEN, with the days on record", () => {
    const dir = repoWith({ "ci.yml": "name: CI\non: [push]\njobs: {}\n" });
    const runs = [
      { workflow: "CI", conclusion: "failure", createdAt: new Date(now - 1 * DAY).toISOString() },
      { workflow: "CI", conclusion: "failure", createdAt: new Date(now - 9 * DAY).toISOString() },
      { workflow: "CI", conclusion: "success", createdAt: new Date(now - 10 * DAY).toISOString() },
    ];
    const r = evaluateMainCi({ projectDir: dir, baseBranch: "main", runsFn: () => runs, nowMs: now });
    expect(r.verdict).toBe(VERDICTS.BROKEN);
    expect(r.evidence).toMatch(/9 day/);
  });
  it("red inside the tolerance: ok, with the red streak noted — a fresh failure is work, not decay", () => {
    const dir = repoWith({ "ci.yml": "name: CI\non: [push]\njobs: {}\n" });
    const runs = [
      { workflow: "CI", conclusion: "failure", createdAt: new Date(now - 1 * DAY).toISOString() },
      { workflow: "CI", conclusion: "success", createdAt: new Date(now - 2 * DAY).toISOString() },
    ];
    const r = evaluateMainCi({ projectDir: dir, baseBranch: "main", runsFn: () => runs, nowMs: now });
    expect(r.verdict).toBe(VERDICTS.OK);
    expect(r.evidence).toMatch(/red for 1 day/);
  });
  it("all green: ok with the last green date as evidence", () => {
    const dir = repoWith({ "ci.yml": "name: CI\non:\n  push: {}\njobs: {}\n" });
    const runs = [{ workflow: "CI", conclusion: "success", createdAt: new Date(now - 1 * DAY).toISOString() }];
    expect(evaluateMainCi({ projectDir: dir, baseBranch: "main", runsFn: () => runs, nowMs: now }).verdict).toBe(VERDICTS.OK);
  });
  describe("each workflow judged on its own (KJC-BUG-0543)", () => {
    const dir = () => repoWith({ "ci.yml": "name: CI\non:\n  push: {}\njobs: {}\n" });
    // The shape `gh run list --json name,conclusion,createdAt` returns.
    const run = (name, conclusion, daysAgo) => ({ name, conclusion, createdAt: new Date(now - daysAgo * DAY).toISOString() });
    const judge = (runs) => evaluateMainCi({ projectDir: dir(), baseBranch: "main", runsFn: () => runs, nowMs: now });
    it("newest run green but another workflow red past the window: broken, names it", () => {
      const r = judge([run("Quality", "success", 0), run("E2E", "failure", 5), run("E2E", "success", 9)]);
      expect(r.verdict).toBe(VERDICTS.BROKEN);
      expect(r.evidence).toMatch(/E2E/);
      expect(r.evidence).not.toMatch(/Quality/);
    });
    it("every workflow green: ok", () => {
      expect(judge([run("Quality", "success", 0), run("E2E", "success", 1)]).verdict).toBe(VERDICTS.OK);
    });
    it("a red followed by the same workflow's own green: ok", () => {
      const r = judge([run("E2E", "success", 1), run("E2E", "failure", 6), run("Quality", "success", 0)]);
      expect(r.verdict).toBe(VERDICTS.OK);
    });
  });
});
// STW-A PR-B — audit freshness. AC5's "never" is GREBLA's real case: 79 days
// with an open redirect and untouched dependencies, and no audit on record.
describe("security-audit freshness — AC5", () => {
  const marked = (daysAgo) => {
    const dir = repoWith(null);
    fs.mkdirSync(path.join(dir, ".karajan", "steward"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "steward", "security-audit.json"), JSON.stringify({ at: new Date(now - daysAgo * DAY).toISOString(), mode: "security" }));
    return dir;
  };
  it("no record at all is BROKEN with 'never' — running it fixes both never and unrecorded", () => {
    const r = evaluateSecurityAudit({ projectDir: repoWith(null), nowMs: now });
    expect(r.verdict).toBe(VERDICTS.BROKEN);
    expect(r.evidence).toMatch(/never/i);
    expect(r.remedy).toMatch(/kj audit --security/);
  });
  it("older than the freshness window: BROKEN with the counter", () => {
    const r = evaluateSecurityAudit({ projectDir: marked(20), nowMs: now });
    expect(r.verdict).toBe(VERDICTS.BROKEN);
    expect(r.evidence).toMatch(/20 days/);
  });
  it("fresh: ok with the date", () => {
    expect(evaluateSecurityAudit({ projectDir: marked(2), nowMs: now }).verdict).toBe(VERDICTS.OK);
  });
});
describe("vulnerable dependencies age by ADVISORY date — AC6", () => {
  const vuln = (severity, daysAgo) => ({ id: "GHSA-x", package: "p", severity, publishedAt: new Date(now - daysAgo * DAY).toISOString() });
  it("no scan handed in: UNKNOWN — a missing scan is never a clean bill", () => {
    expect(evaluateVulnAging({ vulns: null, nowMs: now }).verdict).toBe(VERDICTS.UNKNOWN);
  });
  it("a critical older than its window breaks, dated by the ADVISORY, not the discovery", () => {
    const r = evaluateVulnAging({ vulns: [vuln("CRITICAL", 10)], nowMs: now });
    expect(r.verdict).toBe(VERDICTS.BROKEN);
    expect(r.evidence).toMatch(/advisory/i);
  });
  it("a high inside its 30-day window is ok — reported, not broken", () => {
    expect(evaluateVulnAging({ vulns: [vuln("HIGH", 5)], nowMs: now }).verdict).toBe(VERDICTS.OK);
  });
  it("a critical with no advisory date counts as overdue — unknown age is not youth", () => {
    expect(evaluateVulnAging({ vulns: [{ id: "GHSA-y", severity: "CRITICAL", publishedAt: null }], nowMs: now }).verdict).toBe(VERDICTS.BROKEN);
  });
  it("empty list: ok", () => {
    expect(evaluateVulnAging({ vulns: [], nowMs: now }).verdict).toBe(VERDICTS.OK);
  });
});
// STW-A PR-C — AC4, AC7 and the honest delegation of AC3.
describe("dead-code trend — AC4: derivative, and NO security weight", () => {
  it("no current measurement: UNKNOWN — refresh, never a clean bill", () => {
    expect(evaluateDeadCodeTrend({ current: null }).verdict).toBe(VERDICTS.UNKNOWN);
  });
  it("first measurement: ok — the trend starts here, absence of baseline is not decay", () => {
    const r = evaluateDeadCodeTrend({ current: { deadExports: 12 }, previous: null });
    expect(r.verdict).toBe(VERDICTS.OK);
    expect(r.evidence).toMatch(/first measurement/);
  });
  it("a growing count breaks BY DERIVATIVE, and says dead code carries no security weight", () => {
    const r = evaluateDeadCodeTrend({ current: { deadExports: 20 }, previous: { deadExports: 12, timestamp: "T" } });
    expect(r.verdict).toBe(VERDICTS.BROKEN);
    expect(r.evidence).toMatch(/\+8/);
    expect(r.evidence).toMatch(/no security weight/i);
  });
  it("shrinking or flat: ok with the delta", () => {
    expect(evaluateDeadCodeTrend({ current: { deadExports: 10 }, previous: { deadExports: 12 } }).verdict).toBe(VERDICTS.OK);
  });
});
describe("coverage — AC7: an invariant of CONFIGURATION, not of value", () => {
  it("no threshold configured anywhere: NOT OBSERVABLE — nothing measures the level; no 80% is demanded", () => {
    const r = evaluateCoverageConfig({ projectDir: repoWith(null) });
    expect(r.verdict).toBe(VERDICTS.NOT_OBSERVABLE);
    expect(r.remedy).toMatch(/threshold/);
  });
  it("a vitest config with thresholds: ok — the level itself is CI's job", () => {
    const dir = repoWith(COVERAGE_CI);
    fs.writeFileSync(path.join(dir, "vitest.config.js"), "export default { test: { coverage: { thresholds: { lines: 70 } } } };\n");
    expect(evaluateCoverageConfig({ projectDir: dir }).verdict).toBe(VERDICTS.OK);
  });
  const thresholdRepo = (workflows, pkgScripts) => {
    const dir = repoWith(workflows);
    fs.writeFileSync(path.join(dir, "vitest.config.js"), "export default { test: { coverage: { thresholds: { lines: 70 } } } };\n");
    if (pkgScripts) fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: pkgScripts }));
    return dir;
  };
  const wf = (run) => `jobs:\n  t:\n    steps:\n      - uses: actions/checkout@v4\n      - ${run}\n`;
  it("threshold + a workflow running coverage: ok, evidence names the workflow file", () => {
    const r = evaluateCoverageConfig({ projectDir: thresholdRepo({ "ci.yml": wf("run: npx vitest run --coverage") }) });
    expect(r.verdict).toBe(VERDICTS.OK);
    expect(r.evidence).toMatch(/ci\.yml/);
  });
  it("threshold + no workflow runs coverage: broken, with the remedy", () => {
    const r = evaluateCoverageConfig({ projectDir: thresholdRepo({ "ci.yml": wf("run: npm run lint") }, { lint: "eslint ." }) });
    expect(r.verdict).toBe(VERDICTS.BROKEN);
    expect(r.evidence).toBe("the threshold in vitest.config.js is never applied: no CI workflow runs the tests with coverage");
    expect(r.remedy).toBe("run the tests with coverage in CI (e.g. vitest run --coverage)");
  });
  it("threshold + no .github/workflows: not observable", () => {
    const r = evaluateCoverageConfig({ projectDir: thresholdRepo(null) });
    expect(r.verdict).toBe(VERDICTS.NOT_OBSERVABLE);
    expect(r.evidence).toMatch(/no CI workflows to check/);
  });
  it("an npm script indirection counts: `npm test` whose script runs coverage", () => {
    const r = evaluateCoverageConfig({ projectDir: thresholdRepo({ "ci.yaml": wf("run: npm test") }, { test: "vitest run --coverage" }) });
    expect(r.verdict).toBe(VERDICTS.OK);
    expect(r.evidence).toMatch(/ci\.yaml/);
  });
  it("a multi-line `run: |` block counts, and c8 / nyc too", () => {
    const body = "jobs:\n  t:\n    steps:\n      - run: |\n          npm ci\n          c8 node --test\n      - name: x\n        run: echo done\n";
    expect(evaluateCoverageConfig({ projectDir: thresholdRepo({ "ci.yml": body }) }).verdict).toBe(VERDICTS.OK);
  });
  it("coverage on by default in the parsed vitest config: a plain `npm test` applies it", () => {
    const cases = [
      ["coverage: { enabled: true, thresholds: { lines: 70 } }", VERDICTS.OK],
      ["coverage: { thresholds: { lines: 70 }, enabled: true }", VERDICTS.OK], // order does not matter
      ["coverage: { reportsDirectory: \"c}tmp\", enabled: true, thresholds: { lines: 70 } }", VERDICTS.OK], // brace in a string
      ["\"coverage\": { enabled: true, thresholds: { lines: 70 } }", VERDICTS.OK], // quoted key
      ["browser: { enabled: true }, coverage: { thresholds: { lines: 70 } }", VERDICTS.BROKEN], // enabled elsewhere
    ];
    for (const [testBlock, verdict] of cases) {
      const dir = repoWith({ "ci.yml": wf("run: npm test") });
      fs.writeFileSync(path.join(dir, "vitest.config.js"), `export default { test: { ${testBlock} } };\n`);
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
      expect(evaluateCoverageConfig({ projectDir: dir }).verdict).toBe(verdict);
    }
  });
  it("a `--coverage` on a command that runs no tests does not count", () => {
    for (const run of ["run: echo --coverage", "run: npm install --coverage", "run: echo vitest --coverage", "run: npm audit --coverage", "run: npx vitest run --coverage=false"]) {
      expect(evaluateCoverageConfig({ projectDir: thresholdRepo({ "ci.yml": wf(run) }) }).verdict).toBe(VERDICTS.BROKEN);
    }
  });
  it("the flag counts on a runner or a script that runs one, also after && and with env assignments", () => {
    const scripts = { test: "vitest run", ci: "npm run test" };
    for (const run of ["run: npm ci && CI=1 npx vitest run --coverage", "run: npm test -- --coverage", "run: pnpm run test --coverage", "run: npm run ci -- --coverage"]) {
      expect(evaluateCoverageConfig({ projectDir: thresholdRepo({ "ci.yml": wf(run) }, scripts) }).verdict).toBe(VERDICTS.OK);
    }
  });
  it("the flag on a missing or non-test script does not count", () => {
    for (const run of ["run: npm run lint -- --coverage", "run: npm run nope -- --coverage"]) {
      expect(evaluateCoverageConfig({ projectDir: thresholdRepo({ "ci.yml": wf(run) }, { lint: "eslint ." }) }).verdict).toBe(VERDICTS.BROKEN);
    }
  });
  it("collectCoverage counts only as a real option, not inside a string or comment", () => {
    const dir = repoWith({ "ci.yml": wf("run: npx jest") });
    fs.writeFileSync(path.join(dir, "jest.config.js"), "// collectCoverage: true\nmodule.exports = { note: \"collectCoverage: true\", coverageThreshold: { global: { lines: 70 } } };\n");
    expect(evaluateCoverageConfig({ projectDir: dir }).verdict).toBe(VERDICTS.BROKEN);
    fs.writeFileSync(path.join(dir, "jest.config.js"), "module.exports = { collectCoverage: true, coverageThreshold: { global: { lines: 70 } } };\n");
    expect(evaluateCoverageConfig({ projectDir: dir }).verdict).toBe(VERDICTS.OK);
  });
  it("without coverage on by default, a plain test run does not apply it", () => {
    expect(evaluateCoverageConfig({ projectDir: thresholdRepo({ "ci.yml": wf("run: npm test") }, { test: "vitest run" }) }).verdict).toBe(VERDICTS.BROKEN);
  });
  it("a coverage word outside any `run:` step does not count", () => {
    const body = "jobs:\n  t:\n    steps:\n      - name: vitest run --coverage\n        run: echo hi\n";
    expect(evaluateCoverageConfig({ projectDir: thresholdRepo({ "ci.yml": body }) }).verdict).toBe(VERDICTS.BROKEN);
  });
  // #3604: in grebla's vitest config `thresholds:` sits 527 chars after `coverage`.
  const configWithGap = (gap, tail) => {
    const dir = repoWith(COVERAGE_CI);
    const filler = `reporter: ['text', 'html'], include: [${"'src/**/*.js', ".repeat(Math.ceil(gap / 15))}]`.slice(0, gap);
    fs.writeFileSync(path.join(dir, "vitest.config.js"), `export default { test: { coverage: { ${filler}\n${tail} } } };\n`);
    return dir;
  };
  it("a threshold ~520 chars after `coverage` (reporters, include lists) is found: ok", () => {
    expect(evaluateCoverageConfig({ projectDir: configWithGap(520, "thresholds: { lines: 80 }") }).verdict).toBe(VERDICTS.OK);
  });
  it("coverage options but no thresholds at all: still NOT OBSERVABLE", () => {
    expect(evaluateCoverageConfig({ projectDir: configWithGap(520, "exclude: ['tests/**']") }).verdict).toBe(VERDICTS.NOT_OBSERVABLE);
  });
  it("a thresholds key more than 800 chars away from `coverage` is not attributed to it", () => {
    expect(evaluateCoverageConfig({ projectDir: configWithGap(820, "thresholds: { lines: 80 }") }).verdict).toBe(VERDICTS.NOT_OBSERVABLE);
  });
});
describe("phantom coverage — the invariant consumes the detectors' output", () => {
  it("without detector output it stays NOT OBSERVABLE — never ok by absence", () => {
    const r = evaluatePhantomCoverage();
    expect(r.verdict).toBe(VERDICTS.NOT_OBSERVABLE);
    expect(r.remedy).toMatch(/detector/i);
  });
  it("with output: phantoms break, an empty list is ok", () => {
    expect(evaluatePhantomCoverage({ phantoms: [{ literal: "Head al que reporta", file: "hierarchy.spec.js" }] }).verdict).toBe(VERDICTS.BROKEN);
    expect(evaluatePhantomCoverage({ phantoms: [] }).verdict).toBe(VERDICTS.OK);
  });
  it("the sweep's reason for not observing travels as the evidence", () => {
    const r = evaluatePhantomCoverage({ reason: "no Lit component in the project" });
    expect(r.verdict).toBe(VERDICTS.NOT_OBSERVABLE);
    expect(r.evidence).toMatch(/no Lit component/);
  });
});
describe("runInvariants — dependencies inherit NOT OBSERVABLE", () => {
  it("a child of a not-observable parent is not-observable, never ok", () => {
    const list = [
      { id: "parent", evaluate: () => ({ verdict: VERDICTS.NOT_OBSERVABLE, remedy: "instrument" }) },
      { id: "child", dependsOn: "parent", evaluate: () => ({ verdict: VERDICTS.OK }) },
      { id: "free", evaluate: () => ({ verdict: VERDICTS.OK }) },
    ];
    const out = runInvariants(list, {});
    expect(out.find((r) => r.id === "child").verdict).toBe(VERDICTS.NOT_OBSERVABLE);
    expect(out.find((r) => r.id === "child").remedy).toMatch(/parent/);
    expect(out.find((r) => r.id === "free").verdict).toBe(VERDICTS.OK);
  });
  it("an evaluator that throws is UNKNOWN — a broken probe is never a green light", () => {
    const out = runInvariants([{ id: "x", evaluate: () => { throw new Error("boom"); } }], {});
    expect(out[0].verdict).toBe(VERDICTS.UNKNOWN);
  });
});
