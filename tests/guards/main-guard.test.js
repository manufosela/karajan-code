// KJC-TSK-1368 (ADR 0037, step 1 of KJC-TSK-1269): what reached main without its checks,
// and whether main's protection still enforces them on admins.
import { describe, expect, it } from "vitest";
import { auditMain } from "../../src/guards/main-guard.js";

const REQUIRED = ["policy-check", "Test (Node 22.x)"];
const green = [{ name: "policy-check", conclusion: "success" }, { name: "Test (Node 22.x)", conclusion: "success" }];
const pr = (number, sha, by = "manufosela") => ({ number, merged_at: "2026-11-01T10:00:00Z", merged_by: { login: by }, base: { ref: "main" }, head: { sha } });
const protection = (overrides = {}) => ({
  enforce_admins: { enabled: true },
  required_status_checks: { contexts: [...REQUIRED] },
  ...overrides,
});

/** A fake GitHub: pulls by merge sha, check results by head sha, and the branch protection. */
const apiOf = ({ pulls = {}, checks = {}, prot = protection() } = {}) => ({
  pullsOf: async (sha) => pulls[sha] ?? [],
  checksOf: async (sha) => checks[sha] ?? [],
  protection: async () => prot,
});
const audit = (commits, world) => auditMain({ branch: "main", commits, requiredChecks: REQUIRED, api: apiOf(world) });

describe("guards/main-guard — KJC-TSK-1368", () => {
  it("all in order: every commit came through a PR whose head passed the required checks", async () => {
    const r = await audit(["m1"], { pulls: { m1: [pr(10, "h1")] }, checks: { h1: green } });
    expect(r).toEqual({ ok: true, merges: [], protection: [] });
  });

  it("a commit with no merged PR into main is a direct push", async () => {
    const r = await audit(["m1"], { pulls: { m1: [{ ...pr(9, "h0"), base: { ref: "dev" } }] } });
    expect(r.ok).toBe(false);
    expect(r.merges).toEqual([{ sha: "m1", kind: "direct-push", detail: "no pull request merged into main" }]);
  });

  it("a PR whose head lacks a required check in success names the PR, who merged it and what was missing", async () => {
    const checks = { h1: [{ name: "policy-check", conclusion: "failure" }] };
    const r = await audit(["m1"], { pulls: { m1: [pr(11, "h1", "someone")] }, checks });
    expect(r.merges).toEqual([{ sha: "m1", kind: "checks-skipped", pr: 11, mergedBy: "someone", missing: ["policy-check", "Test (Node 22.x)"] }]);
  });

  it("skipped and neutral count as passing, as they do for GitHub's required checks", async () => {
    const checks = { h1: [{ name: "policy-check", conclusion: "skipped" }, { name: "Test (Node 22.x)", conclusion: "neutral" }] };
    expect((await audit(["m1"], { pulls: { m1: [pr(12, "h1")] }, checks })).ok).toBe(true);
  });

  it("protection without enforce_admins or without a declared check says what changed", async () => {
    const prot = protection({ enforce_admins: { enabled: false }, required_status_checks: { contexts: ["policy-check"] } });
    const r = await audit([], { prot });
    expect(r.ok).toBe(false);
    expect(r.protection).toEqual([
      "enforce_admins is off: admins can merge past the required checks",
      "required check removed: Test (Node 22.x)",
    ]);
  });

  it("checks declared as objects (the newer protection shape) count too", async () => {
    const prot = protection({ required_status_checks: { contexts: [], checks: REQUIRED.map((context) => ({ context })) } });
    expect((await audit([], { prot })).protection).toEqual([]);
  });

  it("an unprotected main is reported, and an empty declaration is refused", async () => {
    expect((await audit([], { prot: null })).protection).toEqual(["main is not protected"]);
    await expect(auditMain({ branch: "main", commits: [], requiredChecks: [], api: apiOf() })).rejects.toThrow(/required check/);
  });
});
