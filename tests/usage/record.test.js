// HU-4592 (ADR 0064): the local record of every agent call.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendUsage, readUsage, usageFile, withUsageRecord } from "../../src/usage/record.js";
import { addAccount } from "../../src/accounts/store.js";

let home;
let cwd;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-usage-"));
  cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-usage-cwd-")));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

const fakeAgent = (name, runTask, reviewTask = runTask) => ({ name, runTask, reviewTask });
const ticking = () => { let t = 1000; return () => (t += 250); };
const thisMonth = () => new Date().toISOString().slice(0, 7);

describe("usage files (HU-4592)", () => {
  it("appends each call to its UTC month's file, owner-only, and reads them back in order", () => {
    appendUsage({ provider: "claude" }, { home, now: new Date("2026-11-30T23:59:00Z") });
    appendUsage({ provider: "codex" }, { home, now: new Date("2026-11-30T23:59:30Z") });
    appendUsage({ provider: "claude" }, { home, now: new Date("2026-12-01T00:00:10Z") });
    expect(readUsage("2026-11", { home })).toEqual([
      { ts: "2026-11-30T23:59:00.000Z", provider: "claude" },
      { ts: "2026-11-30T23:59:30.000Z", provider: "codex" },
    ]);
    expect(readUsage("2026-12", { home })).toHaveLength(1);
    expect(fs.statSync(usageFile("2026-11", { home })).mode & 0o777).toBe(0o600);
  });

  it("reads an empty month as no calls and refuses a month that is not YYYY-MM", () => {
    expect(readUsage("2026-01", { home })).toEqual([]);
    expect(() => readUsage("../../etc", { home })).toThrow(/not a YYYY-MM month/);
  });

  it("names the broken line instead of skipping it", () => {
    fs.mkdirSync(path.join(home, "usage"));
    fs.writeFileSync(usageFile("2026-11", { home }), '{"provider":"claude"}\n{"prov\n');
    expect(() => readUsage("2026-11", { home })).toThrow(/2026-11.jsonl line 2 is not JSON/);
  });
});

describe("withUsageRecord (HU-4592)", () => {
  it("records project, account, role, model, tokens, cost and duration of a call, and returns its result", async () => {
    fs.mkdirSync(path.join(home, "work"));
    addAccount({ id: "work", provider: "claude", dir: path.join(home, "work") }, { home });
    const result = { ok: true, exitCode: 0, model: "opus", tokens_in: 10, tokens_out: 20, cached_tokens: 5, cost_usd: 0.12 };
    const agent = withUsageRecord(fakeAgent("claude", async () => result), { home, clock: ticking() });
    await expect(agent.runTask({ prompt: "secret prompt", role: "coder", cwd })).resolves.toBe(result);
    const [entry] = readUsage(thisMonth(), { home });
    expect(entry).toMatchObject({
      project: cwd, account: "work", provider: "claude", role: "coder", model: "opus", exitCode: 0,
      durationMs: 250, tokensIn: 10, tokensOut: 20, cachedTokens: 5, costUsd: 0.12, rescue: false,
    });
    expect(JSON.stringify(entry)).not.toContain("secret prompt");
  });

  it("records a reviewer call with nulls where the agent gives no usage", async () => {
    const agent = withUsageRecord(fakeAgent("codex", async () => ({ ok: true, exitCode: 0 })), { home, clock: ticking() });
    await agent.reviewTask({ cwd });
    const [entry] = readUsage(thisMonth(), { home });
    expect(entry).toMatchObject({ provider: "codex", role: "reviewer", account: null, model: null, tokensIn: null, costUsd: null });
  });

  it("records the lines a task's measure gives after the call (HU-4619)", async () => {
    const agent = withUsageRecord(fakeAgent("claude", async () => ({ ok: true, exitCode: 0 })), { home });
    await agent.runTask({ cwd, measureLines: () => ({ linesAdded: 7, linesRemoved: 3 }) });
    expect(readUsage(thisMonth(), { home })[0]).toMatchObject({ linesAdded: 7, linesRemoved: 3 });
  });

  it("records a call that throws and lets the error through", async () => {
    const agent = withUsageRecord(fakeAgent("claude", async () => { throw new Error("boom"); }), { home, clock: ticking() });
    await expect(agent.runTask({ cwd })).rejects.toThrow("boom");
    expect(readUsage(thisMonth(), { home })).toEqual([expect.objectContaining({ exitCode: null })]);
  });

  it("warns and still returns the result when the record cannot be written", async () => {
    fs.writeFileSync(path.join(home, "usage"), "a file where the folder should be");
    const logger = { warn: vi.fn() };
    const agent = withUsageRecord(fakeAgent("claude", async () => ({ ok: true })), { home, logger });
    await expect(agent.runTask({ cwd })).resolves.toEqual({ ok: true });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/usage: could not record the claude call/));
  });
});
