// KJC-TSK-0689 (MG-D) — the aggregate trail is the drift detector: the
// human sees at a glance where the agent deviates (commits without card,
// [root] reviews, source commits without tests), even when each single
// case was legitimate.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectMethodStats, getMethodChecks } from "../../src/checks/method.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-mth-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const gitRuns = ({ subjects, blocks }) => vi.fn(async (cmd, args) => {
  if (args.includes("--format=%s")) return { exitCode: 0, stdout: subjects.join("\n") };
  if (args.includes("--name-only")) return { exitCode: 0, stdout: blocks };
  return { exitCode: 0, stdout: "" };
});

describe("collectMethodStats", () => {
  it("counts card refs in subjects, verdict workspaces and testless source commits", async () => {
    const reviews = path.join(dir, ".karajan", "reviews");
    fs.mkdirSync(reviews, { recursive: true });
    fs.writeFileSync(path.join(reviews, "a.json"), JSON.stringify({ verdict: "approved", workspace: "root", timestamp: "2026-07-24T10:00:00Z" }));
    fs.writeFileSync(path.join(reviews, "b.json"), JSON.stringify({ verdict: "approved", workspace: "worktree:x", timestamp: "2026-07-24T11:00:00Z" }));
    fs.writeFileSync(path.join(reviews, "c.json"), JSON.stringify({ verdict: "approved", timestamp: "2026-07-23T09:00:00Z" })); // pre-stamp era

    const run = gitRuns({
      subjects: ["feat: add gate (KJC-TSK-0686)", "fix: quick patch", "docs: readme"],
      blocks: "@abc123\nsrc/a.js\ntests/a.test.js\n\n@def456\nsrc/b.js\n\n@0f9e8d\nREADME.md\n",
    });
    const s = await collectMethodStats({ projectDir: dir, run });
    expect(s.commits).toMatchObject({ total: 3, withCard: 1 }); // multi-segment KJC-TSK-0686 counts
    expect(s.verdicts).toMatchObject({ total: 3, stamped: 2, root: 1 });
    expect(s.testless).toMatchObject({ sampled: 3, offenders: 1 }); // src/b.js alone
  });

  // KJC-TSK-0838 (ADR 2026-09-13): the sonar block of every verdict is the
  // method's evidence — proved, docs-only, human-granted, or UNPROVED. An
  // approved verdict for code without proof turns the method check red.
  it("classifies verdicts by their sonar proof and flags approved unproved ones", async () => {
    const reviews = path.join(dir, ".karajan", "reviews");
    fs.mkdirSync(reviews, { recursive: true });
    const write = (name, rec) => fs.writeFileSync(path.join(reviews, name), JSON.stringify({ verdict: "approved", timestamp: "2026-09-14T10:00:00Z", ...rec }));
    write("proved.json", { sonar: { ran: true, mode: "pass", covered: ["src/a.js"], uncovered: [] } });
    write("docs.json", { sonar: { ran: false, mode: "docs-only", reason: "server down" } });
    write("granted.json", { sonar: { ran: false, mode: "granted", reason: "server down" } });
    write("pipeline-skipped.json", { host: "kj-pipeline", sonar: { ran: false, source: "pipeline", reason: "no git remote" } });
    write("blind.json", { sonar: { ran: true, mode: "pass", covered: [], uncovered: ["packages/x/b.py"] } });
    write("legacy.json", {}); // pre-ADR verdict: no block, not counted
    write("legacy-block.json", { sonar: { ran: false, reason: "HTTP 403" } }); // block but no mode: before fail-closed, not counted

    const s = await collectMethodStats({ projectDir: dir, run: gitRuns({ subjects: [], blocks: "" }) });
    expect(s.sonar).toEqual({ proved: 1, docsOnly: 1, granted: 1, unproved: 2 });

    const [check] = getMethodChecks();
    const r = await check.detect({ config: {}, projectDir: dir, run: gitRuns({ subjects: [], blocks: "" }) });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("fail");
    expect(r.detail).toMatch(/2 approved verdict\(s\) without sonar proof/);
  });

  // KJC-TSK-0849 (ADR 0010, RAG-C): the rag block is the twin evidence — the
  // session asked about every source, or the method is red. Pipeline verdicts
  // (no block, warn sealed at commit) and pre-ADR verdicts are not counted.
  it("classifies verdicts by their rag proof and flags approved unproved ones", async () => {
    const reviews = path.join(dir, ".karajan", "reviews");
    fs.mkdirSync(reviews, { recursive: true });
    const sonar = { ran: true, mode: "pass", covered: ["src/a.js"], uncovered: [] };
    const write = (name, rag) => fs.writeFileSync(path.join(reviews, name), JSON.stringify({ verdict: "approved", timestamp: "2026-09-18T10:00:00Z", sonar, ...(rag ? { rag } : {}) }));
    write("proved.json", { mode: "pass", queries: 2, covered: ["src/a.js"], uncovered: [], twinsUntouched: ["src/z.js"] });
    write("docs.json", { mode: "docs-only", covered: [], uncovered: [] });
    write("granted.json", { mode: "granted", covered: [], uncovered: [] });
    write("bare.json", { mode: "no-harness", covered: [], uncovered: [] });
    write("blind.json", { mode: "pass", covered: [], uncovered: ["src/a.js"] });
    write("tampered.json", { mode: "whatever", covered: ["src/a.js"], uncovered: [] });
    write("hollow.json", { mode: "pass", covered: [], uncovered: [] }); // a pass that covers nothing proves nothing
    write("shapeless.json", { mode: "pass", covered: ["src/a.js"], uncovered: null });
    write("pipeline.json", null); // stamped by kj run: no ledger, warn sealed at commit — not counted
    write("legacy-block.json", { covered: [], uncovered: [] }); // block without mode: before the requirement, not counted
    fs.writeFileSync(path.join(reviews, "rejected.json"), JSON.stringify({ verdict: "rejected", timestamp: "2026-09-18T10:00:00Z", rag: { mode: "pass", covered: [], uncovered: ["src/b.js"] } }));

    const s = await collectMethodStats({ projectDir: dir, run: gitRuns({ subjects: [], blocks: "" }) });
    expect(s.rag).toEqual({ proved: 1, docsOnly: 1, granted: 1, noHarness: 1, unproved: 4 });

    const [check] = getMethodChecks();
    const r = await check.detect({ config: {}, projectDir: dir, run: gitRuns({ subjects: [], blocks: "" }) });
    expect(r).toMatchObject({ ok: false, severity: "fail" });
    expect(r.detail).toMatch(/4 approved verdict\(s\) without rag proof/);
    expect(r.detail).toMatch(/rag proof: 1 proved, 1 docs-only, 1 granted, 1 no-harness, 4 unproved/);
  });

  it("degrades to zeros outside a repo or without verdicts", async () => {
    const run = vi.fn(async () => ({ exitCode: 128, stdout: "" }));
    const s = await collectMethodStats({ projectDir: dir, run });
    expect(s.commits.total).toBe(0);
    expect(s.verdicts.total).toBe(0);
  });
});

describe("card reference pattern (shared with card-first)", () => {
  it("counts multi-segment ids like KJC-TSK-0686 as a single valid reference", async () => {
    const run = gitRuns({ subjects: ["feat(gates): card-first gate (KJC-TSK-0686, MG-A)"], blocks: "" });
    const s = await collectMethodStats({ projectDir: dir, run });
    expect(s.commits).toMatchObject({ total: 1, withCard: 1 });
  });
});

describe("method check for kj doctor", () => {
  it("reports info normally and warn when most commits lack a card ref", async () => {
    const check = getMethodChecks()[0];
    const ok = await check.detect({ config: {}, projectDir: dir, run: gitRuns({ subjects: ["feat: x (ABC-1)", "fix: y (ABC-2)"], blocks: "" }) });
    expect(ok.ok).toBe(true);
    const bad = await check.detect({ config: {}, projectDir: dir, run: gitRuns({ subjects: ["a", "b", "c", "d", "e", "f"], blocks: "" }) });
    expect(bad.severity).toBe("warn");
    expect(bad.detail).toMatch(/card/i);
  });
});
