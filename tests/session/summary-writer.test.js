import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  buildSummaryMarkdown,
  writeSummaryJournal,
} from "../../src/session/journal/summary-writer.js";

function sample(overrides = {}) {
  return {
    sessionId: "s-test",
    task: "implement auth",
    result: "APPROVED",
    iterations: 3,
    durationMs: 125_000,
    budget: {
      total_cost_usd: 0.42,
      total_tokens: 54321,
      breakdown_by_role: {
        coder: { total_tokens: 30000, total_cost_usd: 0.25 },
        reviewer: { total_tokens: 24321, total_cost_usd: 0.17 },
      },
    },
    stages: {
      triage: { ok: true, summary: "medium / sw" },
      coder: { ok: true, summary: "3 files modified" },
      reviewer: { ok: true, summary: "approved" },
    },
    commits: [
      { hash: "abc1234567", message: "feat: add login" },
      { hash: "def4567", message: "test: login e2e" },
    ],
    files: ["iterations.md", "decisions.md", "tree.txt"],
    startedAt: "2026-04-19T12:00:00.000Z",
    finishedAt: "2026-04-19T12:02:05.000Z",
    brainDecisions: 2,
    solomonInvocations: 1,
    ...overrides,
  };
}

describe("session/journal/summary-writer — buildSummaryMarkdown", () => {
  it("includes the required AC fields: task, result, iterations, duration, budget, stages, files, commits", () => {
    const md = buildSummaryMarkdown(sample());
    expect(md).toContain("# Session summary — s-test");
    expect(md).toContain("**Task**: implement auth");
    expect(md).toContain("**Result**: ✅ APPROVED");
    expect(md).toContain("**Iterations**: 3");
    expect(md).toContain("**Duration**: 2m 5s");
    expect(md).toContain("**Budget**: $0.42 · 54,321 tokens");
    expect(md).toContain("## Stages");
    expect(md).toContain("`coder`");
    expect(md).toContain("3 files modified");
    expect(md).toContain("## Commits");
    expect(md).toContain("`abc1234`");
    expect(md).toContain("## Journal files");
    expect(md).toContain("[iterations.md](./iterations.md)");
    expect(md).toContain("[decisions.md](./decisions.md)");
    expect(md).toContain("[tree.txt](./tree.txt)");
  });

  it("renders stages as a Markdown table with pass/fail badges", () => {
    const md = buildSummaryMarkdown(sample({
      stages: {
        coder: { ok: true, summary: "ok" },
        reviewer: { ok: false, summary: "found blockers" },
      },
    }));
    expect(md).toContain("| Stage | Status | Summary |");
    expect(md).toContain("| `coder` | ✅ pass | ok |");
    expect(md).toContain("| `reviewer` | ❌ fail | found blockers |");
  });

  it("renders budget breakdown table when per-role data present", () => {
    const md = buildSummaryMarkdown(sample());
    expect(md).toContain("## Budget breakdown (by role)");
    expect(md).toContain("| Role | Tokens | Cost |");
    expect(md).toContain("`coder`");
    expect(md).toContain("$0.2500");
  });

  it("omits budget breakdown section when all roles have 0 usage", () => {
    const md = buildSummaryMarkdown(sample({
      budget: { total_cost_usd: 0, total_tokens: 0, breakdown_by_role: { coder: { total_tokens: 0, total_cost_usd: 0 } } },
    }));
    expect(md).not.toContain("## Budget breakdown");
  });

  it("shows placeholder text when no stages, commits, or files", () => {
    const md = buildSummaryMarkdown(sample({ stages: {}, commits: [], files: [] }));
    expect(md).toContain("_No stages recorded._");
    expect(md).toContain("_No commits in this session._");
    expect(md).toContain("_No additional journal files._");
  });

  it("formats REJECTED and PAUSED results with appropriate badges", () => {
    const md1 = buildSummaryMarkdown(sample({ result: "REJECTED" }));
    expect(md1).toContain("❌ REJECTED");
    const md2 = buildSummaryMarkdown(sample({ result: "PAUSED" }));
    expect(md2).toContain("⏸ PAUSED");
  });

  it("formats durations > 1h as h+m+s", () => {
    const md = buildSummaryMarkdown(sample({ durationMs: 3_725_000 })); // 1h 2m 5s
    expect(md).toContain("1h 2m 5s");
  });

  it("formats durations < 1s as ms", () => {
    const md = buildSummaryMarkdown(sample({ durationMs: 450 }));
    expect(md).toContain("450ms");
  });

  it("includes Brain/Solomon counts only when > 0", () => {
    const with0 = buildSummaryMarkdown(sample({ brainDecisions: 0, solomonInvocations: 0 }));
    expect(with0).not.toContain("Brain decisions");
    expect(with0).not.toContain("Solomon invocations");
    const with2 = buildSummaryMarkdown(sample({ brainDecisions: 4, solomonInvocations: 2 }));
    expect(with2).toContain("**Brain decisions**: 4");
    expect(with2).toContain("**Solomon invocations**: 2");
  });

  it("truncates very long stage summaries to 120 chars in the table", () => {
    const longSummary = "x".repeat(300);
    const md = buildSummaryMarkdown(sample({
      stages: { coder: { ok: true, summary: longSummary } },
    }));
    // Row exists, but the summary isn't 300 chars long verbatim.
    expect(md).toContain("`coder`");
    expect(md).not.toContain(longSummary);
  });

  // Φ0-F — KJC-TSK-0524. The Cache hits section reads the new
  // total_cached_tokens / breakdown_by_role.<role>.cached_tokens fields
  // introduced in Φ0-E (KJC-TSK-0523, BudgetTracker cursor-snapshot).
  describe("Cache hits section (Φ0-F, KJC-TSK-0524)", () => {
    it("renders a table with cached tokens, ratio, and estimated savings", () => {
      const md = buildSummaryMarkdown(sample({
        budget: {
          total_cost_usd: 0.42,
          total_tokens: 54321,
          total_cached_tokens: 18000,
          breakdown_by_role: {
            coder:    { tokens_in: 20000, total_tokens: 30000, cached_tokens: 14000, total_cost_usd: 0.25 },
            reviewer: { tokens_in: 18000, total_tokens: 24321, cached_tokens: 4000,  total_cost_usd: 0.17 },
          },
        },
      }));
      expect(md).toContain("## Cache hits");
      expect(md).toContain("**Total cached**: 18,000 tokens");
      expect(md).toContain("| Role | Cached tokens | Ratio (cached/in) | Est. savings |");
      // coder first (more cached); 14000/20000 = 70.0%, savings ≈ 0.25 * 0.7 * 0.9 = 0.1575
      expect(md).toMatch(/\| `coder` \| 14,000 \| 70\.0% \| ~\$0\.1575 \|/);
      // reviewer: 4000/18000 ≈ 22.2%, savings ≈ 0.17 * (4000/18000) * 0.9 ≈ 0.034
      expect(md).toMatch(/\| `reviewer` \| 4,000 \| 22\.2% \| ~\$0\.034\d \|/);
    });

    it("renders 'cold run' placeholder when no role has cached tokens", () => {
      const md = buildSummaryMarkdown(sample({
        budget: {
          total_cost_usd: 0.42,
          total_tokens: 54321,
          total_cached_tokens: 0,
          breakdown_by_role: {
            coder:    { tokens_in: 20000, total_tokens: 30000, cached_tokens: 0, total_cost_usd: 0.25 },
            reviewer: { tokens_in: 18000, total_tokens: 24321, cached_tokens: 0, total_cost_usd: 0.17 },
          },
        },
      }));
      expect(md).toContain("## Cache hits");
      expect(md).toContain("_Cache hits: 0 tokens (cold run)._");
      expect(md).not.toContain("Total cached");
    });

    it("omits the Cache hits section when budget itself is absent", () => {
      const md = buildSummaryMarkdown(sample({ budget: undefined }));
      expect(md).not.toContain("## Cache hits");
    });
  });

  // regression-for: TSK-0327
  describe("Skills section (KJC-TSK-0327)", () => {
    it("omits the Skills section entirely when no skills activity happened", () => {
      const md = buildSummaryMarkdown(sample()); // no `skills` field
      expect(md).not.toContain("## Skills Used");
    });

    it("renders addyosmani resolved slugs when catalog is available", () => {
      const md = buildSummaryMarkdown(sample({
        skills: {
          addyosmani: {
            available: true,
            action: "pulled",
            resolvedSlugs: ["test-driven-development", "code-review-and-quality"],
          },
        },
      }));
      expect(md).toContain("## Skills Used");
      expect(md).toContain("**addyosmani/agent-skills** (process, 1st source): pulled");
      expect(md).toContain("`test-driven-development`");
      expect(md).toContain("`code-review-and-quality`");
    });

    it("reports addyosmani as unavailable with the reason when git/network failed", () => {
      const md = buildSummaryMarkdown(sample({
        skills: {
          addyosmani: { available: false, reason: "git not available" },
        },
      }));
      expect(md).toContain("**addyosmani/agent-skills**: unavailable — git not available");
    });

    it("lists OpenSkills that were actually installed this run", () => {
      const md = buildSummaryMarkdown(sample({
        skills: {
          installed: ["vitest-patterns", "owasp-top-10"],
        },
      }));
      expect(md).toContain("## Skills Used");
      expect(md).toContain("**OpenSkills installed**: `vitest-patterns`, `owasp-top-10`");
    });

    it("lists recommended OpenSkills when the CLI was missing (would-have-used)", () => {
      const md = buildSummaryMarkdown(sample({
        skills: {
          recommended: ["astro", "react"],
        },
      }));
      expect(md).toContain("**OpenSkills recommended** (CLI missing, would-have-used): `astro`, `react`");
    });

    it("combines all three sources when present together", () => {
      const md = buildSummaryMarkdown(sample({
        skills: {
          addyosmani: { available: true, action: "fresh", resolvedSlugs: ["security-and-hardening"] },
          installed: ["prisma"],
          recommended: ["nextjs"],
        },
      }));
      expect(md).toContain("addyosmani/agent-skills");
      expect(md).toContain("OpenSkills installed");
      expect(md).toContain("OpenSkills recommended");
    });

    it("handles addyosmani with empty resolvedSlugs (no role/task-specific match)", () => {
      const md = buildSummaryMarkdown(sample({
        skills: {
          addyosmani: { available: true, action: "fresh", resolvedSlugs: [] },
        },
      }));
      expect(md).toContain("no role/task-specific slugs resolved");
    });
  });

  it("escapes pipe chars in commit messages + task text (table safety)", () => {
    const md = buildSummaryMarkdown(sample({
      task: "a|b|c",
      commits: [{ hash: "xxx", message: "fix | something" }],
    }));
    expect(md).toContain("a\\|b\\|c");
    expect(md).toContain("fix \\| something");
  });
});

describe("session/journal/summary-writer — writeSummaryJournal", () => {
  const cleanups = [];

  afterEach(async () => {
    for (const p of cleanups) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    cleanups.length = 0;
  });

  it("writes summary.md to the given journal directory", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-summary-"));
    cleanups.push(tmp);
    const result = await writeSummaryJournal(tmp, sample());
    expect(result.written).toBe(true);
    expect(result.path).toBe(path.join(tmp, "summary.md"));
    const content = await fs.readFile(result.path, "utf8");
    expect(content).toContain("# Session summary — s-test");
  });

  it("returns written:false when the directory cannot be written to", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-summary-ro-"));
    cleanups.push(tmp);
    await fs.writeFile(path.join(tmp, "blocker"), "file");
    const badDir = path.join(tmp, "blocker", "under-a-file");
    const result = await writeSummaryJournal(badDir, sample());
    expect(result.written).toBe(false);
    expect(result.path).toBeNull();
  });

  // KJC-TSK-0376 — Plan adherence section.
  describe("Plan adherence section", () => {
    it("omits the section when planAdherence is missing or null", () => {
      expect(buildSummaryMarkdown(sample())).not.toContain("## Plan adherence");
      expect(buildSummaryMarkdown(sample({ planAdherence: null }))).not.toContain("## Plan adherence");
    });

    it("omits the section when score is null (no data to compute)", () => {
      const md = buildSummaryMarkdown(sample({
        planAdherence: { score: null, breakdown: {}, hu_scores: [] },
      }));
      expect(md).not.toContain("## Plan adherence");
    });

    it("renders score, breakdown table, and unattributed HUs", () => {
      const md = buildSummaryMarkdown(sample({
        planAdherence: {
          score: 87,
          breakdown: {
            commit_attribution: 100,
            acceptance_tests: 67,
            scope_discipline: 80,
            dependency_order: null,
          },
          hu_scores: [
            { huId: "hu_001", attributed: true, issues: [] },
            { huId: "hu_002", attributed: false, issues: ["no commit attributed"] },
          ],
        },
      }));
      expect(md).toContain("## Plan adherence");
      expect(md).toContain("**Score**: 87/100");
      expect(md).toContain("| Commit attribution | 100/100 | 40% |");
      expect(md).toContain("| Acceptance tests | 67/100 | 30% |");
      expect(md).toContain("| Dependency order | n/a | 10% |");
      expect(md).toContain("1 HU(s) without an attributed commit");
      expect(md).toContain("`hu_002`");
    });

    it("hides the unattributed-HUs list when all HUs got at least one commit", () => {
      const md = buildSummaryMarkdown(sample({
        planAdherence: {
          score: 100,
          breakdown: { commit_attribution: 100, acceptance_tests: 100, scope_discipline: 100, dependency_order: 100 },
          hu_scores: [
            { huId: "hu_001", attributed: true, issues: [] },
          ],
        },
      }));
      expect(md).toContain("## Plan adherence");
      expect(md).not.toContain("without an attributed commit");
    });
  });
});
