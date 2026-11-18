// HU-4632 (ADR 0064): GET /api/usage aggregates kj's usage record by period, project and account.
// The record is written with kj's own appendUsage, so the format both sides read is one contract.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendUsage } from "../../../src/usage/record.js";
import usageRoutes from "../src/routes/usage.js";

let home;
let app;
const call = (iso, entry) => appendUsage({ provider: "claude", role: "coder", model: "m", exitCode: 0, rescue: false, ...entry }, { home, now: new Date(iso) });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-usage-route-"));
  vi.stubEnv("KARAJAN_HOME", home);
  app = express();
  app.use("/api/usage", usageRoutes);
  call("2026-10-31T23:00:00Z", { project: "/w/alpha", account: "personal", tokensIn: 10, tokensOut: 5, cachedTokens: 1, costUsd: 0.5, durationMs: 100, linesAdded: 3, linesRemoved: 1 });
  call("2026-11-01T09:00:00Z", { project: "/w/alpha", account: "personal", tokensIn: 20, tokensOut: 5, cachedTokens: null, costUsd: 0.25, durationMs: 50, linesAdded: null, linesRemoved: null });
  call("2026-11-01T10:00:00Z", { project: "/w/alpha", account: "client", tokensIn: null, tokensOut: null, cachedTokens: null, costUsd: null, durationMs: 70, linesAdded: null, linesRemoved: null });
  call("2026-11-02T10:00:00Z", { project: "/w/beta", account: "personal", tokensIn: 1, tokensOut: 1, cachedTokens: 0, costUsd: 0.1, durationMs: 10, linesAdded: 2, linesRemoved: 0 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("GET /api/usage (HU-4632)", () => {
  it("sums one project's calls per month and account, a null staying null where nothing was reported", async () => {
    const res = await request(app).get("/api/usage").query({ period: "month", from: "2026-10", to: "2026-11", project: "/w/alpha" });
    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual(["/w/alpha", "/w/beta"]);
    expect(res.body.rows).toEqual([
      { period: "2026-10", project: "/w/alpha", account: "personal", calls: 1, tokensIn: 10, tokensOut: 5, cachedTokens: 1, costUsd: 0.5, durationMs: 100, linesAdded: 3, linesRemoved: 1 },
      { period: "2026-11", project: "/w/alpha", account: "client", calls: 1, tokensIn: null, tokensOut: null, cachedTokens: null, costUsd: null, durationMs: 70, linesAdded: null, linesRemoved: null },
      { period: "2026-11", project: "/w/alpha", account: "personal", calls: 1, tokensIn: 20, tokensOut: 5, cachedTokens: null, costUsd: 0.25, durationMs: 50, linesAdded: null, linesRemoved: null },
    ]);
  });

  it("buckets by day, by year and in a single total across every project", async () => {
    const day = await request(app).get("/api/usage").query({ period: "day", from: "2026-11", to: "2026-11" });
    expect(day.body.rows.map((r) => `${r.period} ${r.project} ${r.account}`)).toEqual(["2026-11-01 /w/alpha client", "2026-11-01 /w/alpha personal", "2026-11-02 /w/beta personal"]);
    const year = await request(app).get("/api/usage").query({ period: "year", from: "2026-10", to: "2026-11", project: "/w/beta" });
    expect(year.body.rows).toMatchObject([{ period: "2026", calls: 1 }]);
    const total = await request(app).get("/api/usage").query({ period: "total", from: "2026-10", to: "2026-11", project: "/w/alpha" });
    expect(total.body.rows.find((r) => r.account === "personal")).toMatchObject({ period: "total", calls: 2, tokensIn: 30, costUsd: 0.75, linesAdded: 3 });
  });

  it("is empty for months with no record", async () => {
    const res = await request(app).get("/api/usage").query({ period: "month", from: "2025-01", to: "2025-02" });
    expect(res.body).toMatchObject({ ok: true, projects: [], rows: [] });
  });

  it("rejects a period, a month or a range it does not know", async () => {
    for (const query of [{ period: "week", from: "2026-11", to: "2026-11" }, { period: "month", from: "2026-13", to: "2026-11" }, { period: "month", from: "2026-11", to: "2026-10" }]) {
      const res = await request(app).get("/api/usage").query(query);
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    }
  });

  it("fails loudly on a broken line, naming it", async () => {
    fs.appendFileSync(path.join(home, "usage", "2026-11.jsonl"), "{not json\n");
    const res = await request(app).get("/api/usage").query({ period: "month", from: "2026-11", to: "2026-11" });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/2026-11\.jsonl line 4/);
  });
});
