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
import { VERDICTS, resolveFreshness, evaluateMainCi, runInvariants } from "../../src/steward/invariants.js";
const repoWith = (workflows) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-steward-"));
  if (workflows) {
    fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
    for (const [name, body] of Object.entries(workflows)) fs.writeFileSync(path.join(dir, ".github", "workflows", name), body);
  }
  return dir;
};
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
