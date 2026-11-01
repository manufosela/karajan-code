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
  reviewerFailureMessage,
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

// KJC-BUG-0451 (#2799): every codex JSON event carries a `rate_limits` telemetry field,
// so ANY codex failure matched /rate.?limit/ and was reported as exhausted quota.
describe("isQuotaExhausted ignores codex's rate_limits telemetry", () => {
  const telemetry = '{"type":"token_count","rate_limits":{"primary":{"used_percent":3.0,"window_minutes":300},"secondary":{"used_percent":2.0}}}';
  it("a routing failure next to the telemetry is not quota", () => {
    expect(isQuotaExhausted(`${telemetry}\nERROR: workspace routing discovery failed`)).toBe(false);
  });
  it("the real quota message still is, telemetry or not", () => {
    expect(isQuotaExhausted(`${telemetry}\n${CODEX_REAL_ERROR}`)).toBe(true);
    expect(isQuotaExhausted('{"error":{"code":"rate_limit_exceeded"}}')).toBe(true);
  });
});

// KJC-BUG-0471 (#3064): a revoked codex session is an auth failure, not quota.
const CODEX_REVOKED = 'ERROR: unexpected status 401 Unauthorized: {"error":{"code":"refresh_token_invalidated","message":"Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again."}}';

describe("an auth failure is never quota", () => {
  it("a revoked or expired session is not exhausted quota, even next to rate_limits telemetry", () => {
    expect(isQuotaExhausted(CODEX_REVOKED)).toBe(false);
    expect(isQuotaExhausted(`{"rate_limits":{"primary":{"used_percent":3}}}\n${CODEX_REVOKED}`)).toBe(false);
    expect(isQuotaExhausted("401 Unauthorized: token expired, quota check skipped")).toBe(false);
  });
  it("the message says it is the session, names the account and tells how to sign in again", () => {
    const msg = reviewerFailureMessage("codex", CODEX_REVOKED, { account: "codex-tribbu" });
    expect(msg).toMatch(/refresh_token_invalidated/);
    expect(msg).toMatch(/not signed in.*codex-tribbu/);
    expect(msg).toMatch(/codex logout.*codex login/);
    expect(msg).not.toMatch(/cuota|quota/i);
  });
});

describe("reviewerFailureMessage", () => {
  it("a failure codex hits before reaching its service gets the real error and a sandbox/network hint", () => {
    const msg = reviewerFailureMessage("codex", "ERROR: workspace routing discovery failed");
    expect(msg).toMatch(/workspace routing discovery failed/);
    expect(msg).toMatch(/sandbox|network/i);
  });
  it("any other failure is shown as it is, without a hint", () => {
    expect(reviewerFailureMessage("codex", "boom")).toBe("reviewer codex failed: boom");
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
    // "mete también copilot y no sé si alguna más" (2026-08-06): copilot ya
    // estaba; el hueco real era aider — adaptador kj desde v1, auth por env.
    expect(REVIEWER_CANDIDATES.map((c) => c.name)).toContain("aider");
  });

  it("aider authenticates via env keys (no session file), checked against an injected env", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-fb-aider-"));
    const base = { home, checkBin: async () => ({ ok: true }) };
    const withKey = await candidateStatus({ ...base, env: { OPENAI_API_KEY: "sk-test" } });
    expect(withKey.find((s) => s.name === "aider").authenticated).toBe(true);
    const without = await candidateStatus({ ...base, env: {} });
    expect(without.find((s) => s.name === "aider").authenticated).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });

  // KJC-TSK-1344: a claude-tribbu session sets CODEX_HOME=~/.codex-tribbu; the
  // personal ~/.codex session must not count for it, nor the other way round.
  it("codex's session is looked for in CODEX_HOME, not in a fixed ~/.codex", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-fb-codexhome-"));
    const work = path.join(home, ".codex-work");
    fs.mkdirSync(work);
    fs.writeFileSync(path.join(work, "auth.json"), "{}");
    const base = { home, checkBin: async () => ({ ok: true }) };
    const codexOf = async (env) => (await candidateStatus({ ...base, env })).find((s) => s.name === "codex");
    expect((await codexOf({ CODEX_HOME: work })).authenticated).toBe(true);
    expect((await codexOf({})).authenticated).toBe(false); // ~/.codex has no session here
    fs.mkdirSync(path.join(home, ".codex"));
    fs.writeFileSync(path.join(home, ".codex", "auth.json"), "{}");
    expect((await codexOf({ CODEX_HOME: path.join(home, ".codex-empty") })).authenticated).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
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

  // KJC-TSK-1344: with two codex subscriptions the review says which account it used.
  it("the reviewer line names CODEX_HOME when it moves codex's account, and nothing when it does not", async () => {
    const agents = { codex: { reviewTask: async () => ({ ok: true, output: JSON.stringify({ approved: true, blocking_issues: [], summary: "ok" }) }) } };
    const lineFor = async (env) => {
      const infos = [];
      const args = { ...baseArgs(agents), env, persist: false };
      args.logger = { info: (m) => infos.push(m), warn: () => {} };
      await runOneShotReview(args);
      return infos.find((m) => m.includes("reviewer=codex"));
    };
    expect(await lineFor({ CODEX_HOME: "/home/u/.codex-tribbu" })).toContain("CODEX_HOME=/home/u/.codex-tribbu");
    expect(await lineFor({})).not.toContain("CODEX_HOME");
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
