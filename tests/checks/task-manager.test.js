// HU-3337 (epic #3332, ADR 0029): kj doctor shows what the chosen task manager can and cannot do,
// and names the credentials it needs that are unset (names only, never values).
import { describe, it, expect } from "vitest";
import { createTaskManagerCheck } from "../../src/checks/task-manager.js";

const github = { backend: "github", repo: "acme/app" };
const make = (board, extra = {}) => createTaskManagerCheck({ projectDir: "/r", boardConfig: async () => board, ...extra });

describe("doctor: task manager check", () => {
  it("lists what the shared board's manager can and cannot do, and where to see the rest", async () => {
    const r = await make(github).detect();
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/GitHub Issues.*can: .*review verdicts on the PR.*cannot: the full dependency graph \(see it in the HU Board: kj board start\)/);
  });

  it("has nothing to say when the HU Board itself is the backend", async () => {
    const r = await make({ backend: "local" }).detect();
    expect(r).toMatchObject({ ok: true, detail: expect.stringMatching(/HU Board/) });
  });

  it("warns, by name only, about a credential the manager needs and the environment lacks", async () => {
    const manager = { capabilities: { acceptanceCriteria: "field", dependencies: "graph", assignee: true, verdicts: "comment", offline: true }, credentials: ["SOME_TOKEN"] };
    const r = await make(github, { makeManager: () => manager, env: { SOME_TOKEN: "s3cret" } }).detect();
    expect(r.ok).toBe(true);
    const missing = await make(github, { makeManager: () => manager, env: {} }).detect();
    expect(missing).toMatchObject({ ok: false, severity: "warn" });
    expect(missing.detail).toMatch(/SOME_TOKEN is not set/);
    expect(JSON.stringify(r)).not.toContain("s3cret");
  });
});
