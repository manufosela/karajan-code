// KJC-TSK-1429 (format decided by the maintainer on 2026-11-05): an agent kj
// launches leaves a start and an end line in .karajan/harness/agent-activity.jsonl,
// so kj stage knows who works now. Never the prompt nor the output.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTIVITY_FILE, traceActivity } from "../../src/agents/activity.js";
import { noteLoaded } from "../../src/skills/loaded.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-activity-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const lines = () => readFileSync(join(dir, ACTIVITY_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const fakeAgent = (result) => ({
  runTask: vi.fn(async () => result()),
  reviewTask: vi.fn(async () => result()),
});

describe("traceActivity", () => {
  it("notes the start and the end of a review, with who and in which role", async () => {
    const agent = traceActivity(fakeAgent(() => ({ ok: true })), { name: "codex", role: "reviewer", projectDir: dir });
    expect(await agent.reviewTask({ prompt: "secret prompt" })).toEqual({ ok: true });
    const [start, end] = lines();
    expect(start).toMatchObject({ agent: "codex", role: "reviewer", phase: "start" });
    expect(end).toMatchObject({ agent: "codex", role: "reviewer", phase: "end", outcome: "ok" });
    expect(Date.parse(start.at)).not.toBeNaN();
    expect(readFileSync(join(dir, ACTIVITY_FILE), "utf8")).not.toMatch(/secret/);
  });

  it("the start line carries the atril skills just loaded for that role (KJC-TSK-1428)", async () => {
    noteLoaded(dir, "reviewer", ["tdd", "review-rules"]);
    const agent = traceActivity(fakeAgent(() => "done"), { name: "codex", role: "reviewer", projectDir: dir });
    await agent.reviewTask({});
    await agent.reviewTask({});
    const [first, , second] = lines();
    expect(first).toMatchObject({ phase: "start", skills: ["tdd", "review-rules"] });
    expect(second.skills).toBeUndefined();
  });

  it("notes a failed run as ended with failure, and lets the error through", async () => {
    const agent = traceActivity(fakeAgent(() => { throw new Error("boom"); }), { name: "claude", role: "coder", projectDir: dir });
    await expect(agent.runTask({ prompt: "x" })).rejects.toThrow("boom");
    expect(lines().at(-1)).toMatchObject({ agent: "claude", role: "coder", phase: "end", outcome: "failed" });
  });

  it("wraps only the methods the agent has", async () => {
    const agent = traceActivity({ reviewTask: async () => "seen" }, { name: "codex", role: "reviewer", projectDir: dir });
    expect(agent.runTask).toBeUndefined();
    expect(await agent.reviewTask({})).toBe("seen");
  });

  it("without a project directory it traces nothing and changes nothing", async () => {
    const raw = fakeAgent(() => "done");
    expect(traceActivity(raw, { name: "codex", role: "reviewer" })).toBe(raw);
  });

  it("a trace that cannot be written warns and never breaks the agent's work", async () => {
    writeFileSync(join(dir, ".karajan"), "a file where the folder should be");
    const logger = { warn: vi.fn() };
    const agent = traceActivity(fakeAgent(() => "done"), { name: "agy", role: "solomon", projectDir: dir, logger });
    expect(await agent.reviewTask({})).toBe("done");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/agent activity/));
  });
});
