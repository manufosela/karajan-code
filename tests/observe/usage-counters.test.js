// HU-4853 (KJC-TSK-1767): the usage record turned into counters for the board's observability view.
import { describe, expect, it } from "vitest";
import { usageCounters } from "../../src/observe/usage-counters.js";

const call = (over) => ({
  ts: "2026-11-23T10:00:00.000Z", project: "p1", account: "acc1", provider: "claude", role: "coder",
  model: "m", exitCode: 0, durationMs: 100, tokensIn: 10, tokensOut: 5, cachedTokens: 1, costUsd: 0.5,
  rescue: false, linesAdded: 3, linesRemoved: 1, ...over,
});

describe("usageCounters (HU-4853)", () => {
  it("counts calls, duration, tokens and cost per day, project, account, provider and role", () => {
    const rows = usageCounters([
      call({}),
      call({ ts: "2026-11-23T18:00:00.000Z", durationMs: 50, tokensIn: 2, tokensOut: 1, cachedTokens: null, costUsd: 0.25 }),
      call({ ts: "2026-11-24T09:00:00.000Z", provider: "codex", role: "reviewer", costUsd: null }),
    ]);
    expect(rows).toEqual([
      { day: "2026-11-23", project: "p1", account: "acc1", provider: "claude", role: "coder",
        calls: 2, failures: 0, durationMs: 150, tokensIn: 12, tokensOut: 6, cachedTokens: 1, costUsd: 0.75 },
      { day: "2026-11-24", project: "p1", account: "acc1", provider: "codex", role: "reviewer",
        calls: 1, failures: 0, durationMs: 100, tokensIn: 10, tokensOut: 5, cachedTokens: 1, costUsd: null },
    ]);
  });

  it("counts a call whose exitCode is not 0 as a failure of its group", () => {
    const [row] = usageCounters([call({}), call({ exitCode: 1 }), call({ exitCode: null })]);
    expect(row.calls).toBe(3);
    expect(row.failures).toBe(1);
  });

  it("keeps only the allowed fields, whatever free text a record carries", () => {
    const [row] = usageCounters([call({ prompt: "secret prompt", cwd: "/home/someone/repo", model: "x" })]);
    expect(Object.keys(row).toSorted()).toEqual(
      ["account", "cachedTokens", "calls", "costUsd", "day", "durationMs", "failures", "project", "provider", "role", "tokensIn", "tokensOut"],
    );
    expect(JSON.stringify(row)).not.toMatch(/secret|\/home\//);
  });

  it("sorts the rows by day, project, account, provider and role", () => {
    const rows = usageCounters([call({ ts: "2026-11-24T00:00:00.000Z" }), call({ provider: "agy" }), call({})]);
    expect(rows.map((r) => `${r.day} ${r.provider}`)).toEqual(["2026-11-23 agy", "2026-11-23 claude", "2026-11-24 claude"]);
  });

  it("fails loudly on a record without a valid timestamp", () => {
    expect(() => usageCounters([call({ ts: "yesterday" })])).toThrow(/timestamp/);
  });
});
