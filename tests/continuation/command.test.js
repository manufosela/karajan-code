// KJC-TSK-1651 (ADR 0059): kj continuation gate reads the session's transcript; the hook holds on exit 2.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { continuationGateCommand } from "../../src/commands/continuation.js";
import { savePlan } from "../../src/plan/plan-store.js";

let dir, transcript, errors;
const logger = { error: (line) => errors.push(line) };
const line = (entry) => JSON.stringify(entry);
const toolResult = (text) => ({ type: "user", message: { content: [{ type: "tool_result", content: text }] } });
const said = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const write = (...entries) => writeFileSync(transcript, entries.map(line).join("\n"));
const gate = (mode, handoffs = []) => continuationGateCommand({ flags: { transcript }, config: { projectDir: dir, method_gates: mode ? { continuation: mode } : {} }, logger, handoffsFn: () => handoffs, whoFn: () => "me" });
// The shared board's mirror, as kj hu list writes it on this machine.
const mirror = (hu) => savePlan(dir, { version: 2, planId: "plan-github-board", task: "Shared HU Board", status: "ready", hus: [{ id: "HU-7", short_id: "HU-7", title: "t", ...hu }] });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-continuation-"));
  vi.stubEnv("KJ_PLANS_DIR", join(dir, "plans"));
  transcript = join(dir, "t.jsonl");
  errors = [];
  write({ type: "user", message: { content: "haz las HUs" } }, toolResult("✓ HU created: HU-7 (pending) in the shared board"), said("Llevamos mucho, lo dejamos aquí."));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("kj continuation gate", () => {
  it("holds by default with exit 2 and names the next card", async () => {
    expect(await gate()).toBe(2);
    expect(errors.join("\n")).toMatch(/HU-7/);
  });
  it("only reports in warn mode, and is silent when off", async () => {
    expect(await gate("warn")).toBe(0);
    expect(errors).toHaveLength(1);
    errors = [];
    expect(await gate("off")).toBe(0);
    expect(errors).toEqual([]);
  });
  it("lets a stated stop end the turn while a handoff of the project is open", async () => {
    write(toolResult("✓ HU created: HU-7 (pending)"), said("Me paro por esperar tu sello."));
    expect(await gate(null, [{ status: "pending" }])).toBe(0);
    expect(await gate(null, [{ status: "done" }])).toBe(2);
  });
  // KJC-BUG-0622 (#4478): a card the board has closed, or someone else holds, does not hold the turn.
  it("lets the turn end when the board has done the session's card", async () => {
    await mirror({ status: "done" });
    expect(await gate()).toBe(0);
  });
  it("lets the turn end when someone else holds the card, and holds it when this clone does", async () => {
    await mirror({ status: "running", claimed_by: "someone" });
    expect(await gate()).toBe(0);
    await mirror({ status: "running", claimed_by: "me" });
    expect(await gate()).toBe(2);
  });
  it("gets out of the way when the transcript cannot be read", async () => {
    rmSync(transcript);
    expect(await gate()).toBe(0);
  });
});
