// HU-4899 (KJC-BUG-0662): ADR 0015 retired the KJ_ALLOW_* escapes; no gate reads one. The rules
// the Sentinel gives back after a compaction and the agent guide kj installs must not name them as
// if they were the person's to use: a gate is obeyed, and what is the person's they do in their terminal.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

describe("the reminders name no retired escape (HU-4899)", () => {
  it("the compaction rules of the Sentinel say there is no escape", () => {
    const src = read("src/harden/sentinel/sessionstart.mjs");
    expect(src).not.toMatch(/KJ_ALLOW_/);
    expect(src).toMatch(/no hay escapes \(ADR 0015\)/);
  });

  it("the agent guide kj installs says there is no escape", () => {
    const guide = read("templates/agent-guide/SKILL.md");
    expect(guide).not.toMatch(/KJ_ALLOW_/);
    expect(guide).toMatch(/no escape \(ADR 0015\)/);
  });
});
