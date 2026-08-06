// KJC-TSK-0730 — quota failover: running out of reviewer quota either
// continues with a LOUD notice (an authenticated candidate exists) or prints
// an actionable menu — never a silent failure, never brain self-review.
// Born from the real codex weekly-quota outage of 2026-08-06.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  REVIEWER_CANDIDATES,
  isQuotaExhausted,
  candidateStatus,
  pickQuotaFallback,
  formatCandidateMenu,
} from "../../src/review/reviewer-fallback.js";
import { runOneShotReview } from "../../src/review/one-shot-review.js";

const CODEX_REAL_ERROR =
  "ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 8th, 2026 6:55 AM.";

describe("isQuotaExhausted", () => {
  it("classifies the real codex message plus generic quota/rate-limit shapes, and nothing else", () => {
    expect(isQuotaExhausted(CODEX_REAL_ERROR)).toBe(true);
    expect(isQuotaExhausted("Quota exceeded for this billing period")).toBe(true);
    expect(isQuotaExhausted("429 rate limited, retry later")).toBe(true);
    expect(isQuotaExhausted("SyntaxError: unexpected token")).toBe(false);
    expect(isQuotaExhausted("")).toBe(false);
    expect(isQuotaExhausted(undefined)).toBe(false);
  });
});

describe("candidate registry + status", () => {
  it("every candidate declares name, tier and a login hint; install only when verified", () => {
    for (const c of REVIEWER_CANDIDATES) {
      expect(c.name).toBeTruthy();
      expect(c.tier).toBeTruthy();
      expect(c.login).toBeTruthy();
      expect(Array.isArray(c.authPaths)).toBe(true);
    }
    expect(REVIEWER_CANDIDATES.map((c) => c.name)).toContain("copilot");
    expect(REVIEWER_CANDIDATES.map((c) => c.name)).toContain("kimi");
  });

  it("reports installed × authenticated from local heuristics (fake home)", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-fb-home-"));
    fs.mkdirSync(path.join(home, ".copilot"), { recursive: true });
    fs.writeFileSync(path.join(home, ".copilot", "config.json"), "{}");
    const statuses = await candidateStatus({
      home,
      checkBin: async (name) => ({ ok: name === "copilot" }),
    });
    const copilot = statuses.find((s) => s.name === "copilot");
    expect(copilot.installed).toBe(true);
    expect(copilot.authenticated).toBe(true);
    const kimi = statuses.find((s) => s.name === "kimi");
    expect(kimi.installed).toBe(false);
    expect(kimi.authenticated).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe("pickQuotaFallback", () => {
  const mk = (name, installed, authenticated) => ({ name, installed, authenticated });
  it("picks the first installed+authenticated candidate excluding reviewer and host", () => {
    const statuses = [mk("codex", true, true), mk("copilot", true, true), mk("kimi", true, false)];
    expect(pickQuotaFallback(statuses, { exclude: ["codex", "claude"] })).toBe("copilot");
  });
  it("returns null when nothing valid remains (never the host, never unauthenticated)", () => {
    const statuses = [mk("codex", true, true), mk("claude", true, true), mk("kimi", true, false)];
    expect(pickQuotaFallback(statuses, { exclude: ["codex", "claude"] })).toBeNull();
  });
});

describe("runOneShotReview quota failover", () => {
  const baseArgs = (agents) => ({
    diff: "diff --git a/x.js b/x.js\n+1\n",
    task: "review",
    config: {},
    logger: { info: () => {}, warn: () => {} },
    projectDir: fs.mkdtempSync(path.join(os.tmpdir(), "kj-fb-proj-")),
    hostAgent: "claude",
    detectAgents: async () => [{ name: "codex", available: true }, { name: "copilot", available: true }],
    createAgentFn: (name) => agents[name],
  });

  it("retries ONCE with the fallback, warns loudly, and the verdict records the real reviewer", async () => {
    const warns = [];
    const seenConfigs = {};
    const agents = {
      codex: { reviewTask: async () => ({ ok: false, error: CODEX_REAL_ERROR }) },
      copilot: {
        reviewTask: async () => ({ ok: true, output: JSON.stringify({ approved: true, blocking_issues: [], summary: "ok" }) }),
      },
    };
    const args = baseArgs(agents);
    // The role's model pin belongs to the ORIGINAL provider (found live:
    // codex's gpt-5.4-mini reached copilot and broke it) — the fallback
    // attempt must drop it and use the candidate's default model.
    args.config = { roles: { reviewer: { provider: "codex", model: "gpt-5.4-mini" } } };
    args.createAgentFn = (name, cfg) => {
      seenConfigs[name] = cfg;
      return agents[name];
    };
    args.logger.warn = (m) => warns.push(m);
    args.candidateStatusFn = async () => [
      { name: "codex", installed: true, authenticated: true },
      { name: "copilot", installed: true, authenticated: true },
    ];
    const record = await runOneShotReview(args);
    expect(record.verdict).toBe("approved");
    expect(record.reviewer).toBe("copilot");
    expect(warns.join(" ")).toMatch(/sin cuota|quota/i);
    expect(warns.join(" ")).toMatch(/roles\.reviewer\.provider/);
    expect(seenConfigs.codex.roles.reviewer.model).toBe("gpt-5.4-mini");
    expect(seenConfigs.copilot.roles.reviewer.model).toBeNull();
  });

  it("prints the candidate menu when no candidate is authenticated", async () => {
    const agents = { codex: { reviewTask: async () => ({ ok: false, error: CODEX_REAL_ERROR }) } };
    const args = baseArgs(agents);
    args.candidateStatusFn = async () => [
      { name: "codex", installed: true, authenticated: true },
      { name: "copilot", installed: true, authenticated: false, tier: "gratis", login: "copilot login" },
      { name: "kimi", installed: false, authenticated: false, tier: "gratis", login: "kimi /login" },
    ];
    await expect(runOneShotReview(args)).rejects.toThrow(/candidato|login/i);
  });

  it("does not fall back on non-quota errors", async () => {
    const agents = { codex: { reviewTask: async () => ({ ok: false, error: "boom" }) } };
    const args = baseArgs(agents);
    args.candidateStatusFn = async () => [{ name: "copilot", installed: true, authenticated: true }];
    await expect(runOneShotReview(args)).rejects.toThrow(/boom/);
  });
});

describe("formatCandidateMenu", () => {
  it("lists tier, install/login state and the command for each candidate", () => {
    const menu = formatCandidateMenu([
      { name: "copilot", tier: "gratis", installed: true, authenticated: false, login: "copilot (auth GitHub)" },
      { name: "kimi", tier: "gratis", installed: false, authenticated: false, login: "kimi → /login", install: null },
    ]);
    expect(menu).toContain("copilot");
    expect(menu).toContain("gratis");
    expect(menu).toMatch(/login/i);
  });
});
