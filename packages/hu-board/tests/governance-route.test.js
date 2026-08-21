// GUI-A (KJC-TSK-0771) — GET /api/governance?dir=<project>: policy rules,
// the kj report, anchor state and declared identity of one project. kj is
// mocked through runCommand (the board never imports the CLI tree).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";

vi.mock("karajan-core/process", () => ({ runCommand: vi.fn() }));

import { runCommand } from "karajan-core/process";
import governanceRoutes from "../src/routes/governance.js";

let app, dir;
const REPORT = { chain: { ok: true, length: 3 }, decisions: { total: 3, allow: 2, deny: 1, exempt: 0, open: 1, chokepoints: { commit: 3 } }, rules: [], grants: { alive: [], expired: [], soon: [], renewals: [], point: 0 }, signals: [] };
const kjSays = (report, exitCode = 0) => runCommand.mockResolvedValue({ exitCode, stdout: `${JSON.stringify(report)}\n`, stderr: "" });
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

beforeEach(() => {
  vi.resetAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hu-board-gov-"));
  fs.mkdirSync(path.join(dir, ".karajan"));
  app = express();
  app.use("/api/governance", governanceRoutes);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("GET /api/governance", () => {
  it("400 without dir; 404 when the directory is not a karajan project", async () => {
    expect((await request(app).get("/api/governance")).status).toBe(400);
    const res = await request(app).get("/api/governance").query({ dir: os.tmpdir() });
    expect(res.status).toBe(404);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns policy rules, the kj report, anchor state and declared identity", async () => {
    write(".karajan/policy.yml", "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.env'], enforcement: deny, class: security }\n    shell: { deny: ['rm -rf *'] }\ninvariants:\n  - id: loc-budget\n    kind: diff-threshold\n    metric: net_lines_added\n    max: 200\n");
    write(".karajan/policy-anchor.json", JSON.stringify({ head: "abc", length: 2, ts: "2026-08-21T00:00:00Z" }));
    write(".karajan/identity.local.yml", "gh_user: manufosela\ngit_email: m@example.invalid\n");
    kjSays(REPORT);
    const res = await request(app).get("/api/governance").query({ dir });
    expect(res.status).toBe(200);
    expect(runCommand).toHaveBeenCalledWith("kj", ["policy", "report", "--json"], { cwd: dir });
    expect(res.body.policy.declared).toBe(true);
    expect(res.body.policy.rules).toEqual([
      { rule_id: "roles.coder.write.deny", role: "coder", cap: "write", kind: "deny", patterns: ["**/*.env"], enforcement: "deny", class: "security" },
      { rule_id: "roles.coder.shell.deny", role: "coder", cap: "shell", kind: "deny", patterns: ["rm -rf *"], enforcement: "warn", class: null },
    ]);
    expect(res.body.policy.invariants[0]).toMatchObject({ id: "loc-budget", enforcement: "warn" });
    expect(res.body.report).toEqual(REPORT);
    expect(res.body.anchor).toMatchObject({ sealed: true, head: "abc", length: 2, current: 3, stale: true });
    expect(res.body.identity).toEqual({ declared: true, gh_user: "manufosela", git_email: "m@example.invalid" });
  });

  it("no policy, no anchor, no identity: says so instead of inventing; a broken chain (exit 1) is still data", async () => {
    kjSays({ ...REPORT, chain: { ok: false, at: 1, reason: "prev no casa", length: 0 } }, 1);
    const res = await request(app).get("/api/governance").query({ dir });
    expect(res.status).toBe(200);
    expect(res.body.policy).toEqual({ declared: false, rules: [], invariants: [], error: null });
    expect(res.body.anchor).toMatchObject({ sealed: false, stale: false });
    expect(res.body.identity).toEqual({ declared: false });
    expect(res.body.report.chain.ok).toBe(false);
  });

  it("kj missing is 503 installable; an invalid policy.yml is reported, not thrown", async () => {
    runCommand.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    expect((await request(app).get("/api/governance").query({ dir })).status).toBe(503);
    write(".karajan/policy.yml", "roles: [\n");
    kjSays(REPORT);
    const res = await request(app).get("/api/governance").query({ dir });
    expect(res.status).toBe(200);
    expect(res.body.policy.declared).toBe(true);
    expect(res.body.policy.error).toBeTruthy();
  });
});
