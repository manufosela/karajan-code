// KJC-TSK-1651 (ADR 0059): kj continuation gate reads the session's transcript; the hook holds on exit 2.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { continuationGateCommand } from "../../src/commands/continuation.js";

let dir, transcript, errors;
const logger = { error: (line) => errors.push(line) };
const line = (entry) => JSON.stringify(entry);
const toolResult = (text) => ({ type: "user", message: { content: [{ type: "tool_result", content: text }] } });
const said = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const write = (...entries) => writeFileSync(transcript, entries.map(line).join("\n"));
const gate = (mode, handoffs = []) => continuationGateCommand({ flags: { transcript }, config: { projectDir: dir, method_gates: mode ? { continuation: mode } : {} }, logger, handoffsFn: () => handoffs });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-continuation-"));
  transcript = join(dir, "t.jsonl");
  errors = [];
  write({ type: "user", message: { content: "haz las HUs" } }, toolResult("✓ HU created: HU-7 (pending) in the shared board"), said("Llevamos mucho, lo dejamos aquí."));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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
  it("gets out of the way when the transcript cannot be read", async () => {
    rmSync(transcript);
    expect(await gate()).toBe(0);
  });
});
