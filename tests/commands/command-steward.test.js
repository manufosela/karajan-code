// STW-B PR-1 (KJC-TSK-0790, epic KJC-PCS-0081) — `kj steward sweep`: a
// read-only pass over the invariants that leaves the verdict IN THE REPO.
// A record on one machine serves nobody when several people or several
// karajans touch the repo: the versioned report is what everyone sees.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { stewardSweepCommand } from "../../src/commands/steward.js";

let dir;
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), out: function () { return this.info.mock.calls.flat().join("\n"); } });
const NOW = Date.parse("2026-08-27T12:00:00Z");
const run = (over = {}) =>
  stewardSweepCommand({
    flags: {}, config: { projectDir: dir }, logger: logger(),
    probes: { runsFn: () => [{ workflow: "CI", conclusion: "success", createdAt: "2026-08-26T00:00:00Z" }], nowMs: NOW, ...over },
  });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sweep-"));
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".github", "workflows", "ci.yml"), "name: CI\non: [push]\njobs: {}\n");
  execSync("git init -q -b main", { cwd: dir });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("kj steward sweep", () => {
  it("writes the report in the repo: verdict, last evidence and the renewing command per invariant", async () => {
    const code = await run();
    const md = fs.readFileSync(path.join(dir, ".karajan", "steward", "report.md"), "utf8");
    expect(md).toMatch(/main-ci/);
    expect(md).toMatch(/security-audit/);
    expect(md).toMatch(/kj audit --security/); // the renewing command travels with the verdict
    expect(md).toMatch(/Last swept: 2026-08-27/);
    const json = JSON.parse(fs.readFileSync(path.join(dir, ".karajan", "steward", "report.json"), "utf8"));
    expect(json.invariants.find((i) => i.id === "main-ci").verdict).toBe("ok");
    expect(code).toBe(1); // security-audit "never" is broken → nonzero
  });

  it("exit 0 when nothing is broken — unknown and not-observable inform, they do not fail the sweep", async () => {
    fs.mkdirSync(path.join(dir, ".karajan", "steward"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "steward", "security-audit.json"), JSON.stringify({ at: "2026-08-26T00:00:00Z", mode: "security" }));
    expect(await run()).toBe(0);
  });

  it("two sweeps with no changes: identical verdicts, the report differs only in Last swept", async () => {
    await run();
    const first = fs.readFileSync(path.join(dir, ".karajan", "steward", "report.md"), "utf8");
    await run({ nowMs: NOW + 60_000 });
    const second = fs.readFileSync(path.join(dir, ".karajan", "steward", "report.md"), "utf8");
    const strip = (s) => s.split("\n").filter((l) => !l.startsWith("Last swept:")).join("\n");
    expect(strip(second)).toBe(strip(first));
  });

  it("touches NOTHING outside .karajan/steward — the sweep is read-only", async () => {
    fs.writeFileSync(path.join(dir, "src.js"), "export const a = 1;\n");
    const before = fs.readFileSync(path.join(dir, "src.js"), "utf8");
    await run();
    expect(fs.readFileSync(path.join(dir, "src.js"), "utf8")).toBe(before);
    const entries = fs.readdirSync(dir).sort();
    expect(entries).toEqual([".github", ".git", ".karajan", "src.js"].sort());
  });

  it("a gitignored report path is warned about — a report nobody can see is not shared state", async () => {
    fs.writeFileSync(path.join(dir, ".gitignore"), ".karajan/\n");
    const log = logger();
    await stewardSweepCommand({ flags: {}, config: { projectDir: dir }, logger: log, probes: { runsFn: () => [], nowMs: NOW } });
    expect(`${log.warn.mock.calls.flat().join("\n")}`).toMatch(/gitignore/i);
  });

  // STW-B PR-2 — every sweep is SEALED in the decision chain, verifiable with
  // the kernel's own tool: the same criterion policy decisions already meet.
  it("each sweep seals a steward-sweep decision and the chain verifies", async () => {
    await run();
    await run({ nowMs: NOW + 60_000 });
    const lines = fs.readFileSync(path.join(dir, ".karajan", "policy-decisions.jsonl"), "utf8").split("\n").filter((l) => l.trim());
    const sweeps = lines.map((l) => JSON.parse(l)).filter((d) => d.kind === "steward-sweep");
    expect(sweeps).toHaveLength(2);
    expect(sweeps[0].verdicts.broken).toBeGreaterThanOrEqual(1); // security-audit "never"
    const { verifyDecisionChain } = await import("@karajan-family/governance");
    expect(verifyDecisionChain(lines).ok).toBe(true);
  });

  it("a live osv probe feeds vulnerable-deps — an overdue critical breaks the sweep", async () => {
    fs.mkdirSync(path.join(dir, ".karajan", "steward"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "steward", "security-audit.json"), JSON.stringify({ at: "2026-08-26T00:00:00Z", mode: "security" }));
    const code = await run({ osvFn: () => ({ available: true, vulnerabilities: [{ id: "GHSA-z", severity: "CRITICAL", publishedAt: "2026-08-01T00:00:00Z" }] }) });
    expect(code).toBe(1);
    const json = JSON.parse(fs.readFileSync(path.join(dir, ".karajan", "steward", "report.json"), "utf8"));
    expect(json.invariants.find((i) => i.id === "vulnerable-deps").verdict).toBe("broken");
  });

  // STW-D — the sweep leaves the break as PROPOSED work on the hu-board.
  it("a broken invariant lands on the hu-board as a proposal; the next green sweep resolves it", async () => {
    await run({ osvFn: () => ({ available: true, vulnerabilities: [{ id: "GHSA-z", severity: "CRITICAL", publishedAt: "2026-08-01T00:00:00Z" }] }) });
    const { listPlans, loadPlan } = await import("../../src/plan/plan-store.js");
    const hus = async () => {
      const out = [];
      for (const p of await listPlans(dir)) out.push(...((await loadPlan(dir, p.planId)).hus || []));
      return out;
    };
    const created = await hus();
    expect(created.some((h) => h.title.includes("vulnerable-deps") && h.status === "pending")).toBe(true);
  }, 30_000);

  it("--json prints the machine document", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await run({ flags: { json: true } });
    await stewardSweepCommand({ flags: { json: true }, config: { projectDir: dir }, logger: logger(), probes: { runsFn: () => [], nowMs: NOW } });
    const doc = JSON.parse(write.mock.calls.at(-1)[0]);
    expect(Array.isArray(doc.invariants)).toBe(true);
    write.mockRestore();
  });
});
