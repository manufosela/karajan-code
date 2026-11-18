// HU-4634 (ADR 0064): GET /api/usage/export, one project's calls of one month as CSV for billing.
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
const call = (iso, entry) => appendUsage({ provider: "claude", role: "coder", exitCode: 0, rescue: false, durationMs: 5, tokensIn: 1, tokensOut: 2, cachedTokens: null, costUsd: 0.5, linesAdded: null, linesRemoved: null, ...entry }, { home, now: new Date(iso) });
const HEADER = "ts,project,account,provider,role,model,exitCode,durationMs,tokensIn,tokensOut,cachedTokens,costUsd,rescue,linesAdded,linesRemoved";

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-usage-export-"));
  vi.stubEnv("KARAJAN_HOME", home);
  app = express();
  app.use("/api/usage", usageRoutes);
  call("2026-11-01T09:00:00Z", { project: "/w/client a", account: "client", model: "m, large" });
  call("2026-11-02T09:00:00Z", { project: "/w/client a", account: null, model: '=HYPERLINK("x")' });
  call("2026-11-03T09:00:00Z", { project: "/w/other", account: "personal", model: "m" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("GET /api/usage/export (HU-4634)", () => {
  it("downloads one row per call of the project and month, quoted where needed", async () => {
    const res = await request(app).get("/api/usage/export").query({ project: "/w/client a", month: "2026-11" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="usage-client_a-2026-11.csv"');
    const lines = res.text.trimEnd().split("\r\n");
    expect(lines).toEqual([
      HEADER,
      '2026-11-01T09:00:00.000Z,/w/client a,client,claude,coder,"m, large",0,5,1,2,,0.5,false,,',
      `2026-11-02T09:00:00.000Z,/w/client a,,claude,coder,"'=HYPERLINK(""x"")",0,5,1,2,,0.5,false,,`,
    ]);
  });

  it("is only the header for a month with no calls of the project", async () => {
    const res = await request(app).get("/api/usage/export").query({ project: "/w/client a", month: "2026-10" });
    expect(res.text.trimEnd()).toBe(HEADER);
  });

  it("asks for a project and a YYYY-MM month", async () => {
    for (const query of [{ month: "2026-11" }, { project: "/w/other", month: "2026-1" }]) {
      const res = await request(app).get("/api/usage/export").query(query);
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    }
  });
});
