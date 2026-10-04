// KJC-TSK-0943 (MDR-B2, ADR 0016): kj rules eval — one tool call against
// .karajan/rules.yml, the hook's contract.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRules, rulesEval } from "../../src/commands/rules.js";

const SPRINT_TOOL = "mcp__planning-game-personal__create_sprint";
const rulesYml = (examples) => `
version: 1
rules:
  - id: R-0000000001
    source: CLAUDE.md
    text: "Sprints: uno por día."
    kind: deterministic
    when:
      tool: "mcp__planning-game*__create_sprint"
      any:
        - { arg: allowLongSprint, equals: true }
        - { arg: endDate, days_from: startDate, gt: 0 }
${examples}
  - { id: R-0000000002, kind: judgment, when: { tool: AskUserQuestion } }
`;
const GOOD = `    examples:
      deny:
        - { tool: ${SPRINT_TOOL}, input: { startDate: "2026-10-05", endDate: "2026-10-11" } }
      allow:
        - { tool: ${SPRINT_TOOL}, input: { startDate: "2026-10-05", endDate: "2026-10-05" } }`;

let dir;
const write = (text) => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "rules.yml"), text);
};
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-cmd-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("loadRules", () => {
  it("no rules.yml is no rules, not an error", () => {
    expect(loadRules(dir)).toEqual({ present: false, rules: [], errors: [] });
  });

  it("a rules.yml that exists and cannot be read is an error, never rules silently off", () => {
    fs.mkdirSync(path.join(dir, ".karajan", "rules.yml"), { recursive: true }); // a directory: EISDIR on read
    expect(loadRules(dir).errors[0]).toMatch(/cannot read/);
    expect(rulesEval({ projectDir: dir, tool: "Bash", input: "{}" }).code).toBe(1);
  });
});

describe("kj rules eval", () => {
  it("exit 2 and the rule on a deny, exit 0 on an allow", () => {
    write(rulesYml(GOOD));
    const deny = rulesEval({ projectDir: dir, tool: SPRINT_TOOL, input: '{"startDate":"2026-10-05","allowLongSprint":true}' });
    expect(deny.code).toBe(2);
    expect(deny.output).toMatchObject({ decision: "deny", rule_id: "R-0000000001", source: "CLAUDE.md" });
    expect(rulesEval({ projectDir: dir, tool: SPRINT_TOOL, input: '{"startDate":"2026-10-05"}' })).toEqual({ code: 0, output: { decision: "allow" } });
    expect(rulesEval({ projectDir: dir, tool: "Read" }).code).toBe(0);
  });

  it("exit 1 with the errors on an invalid rules.yml, an unreadable --input or no --tool", () => {
    write("version: 1\nrules:\n  - { id: bad, kind: deterministic, when: { tool: Bash } }");
    const invalid = rulesEval({ projectDir: dir, tool: "Bash", input: "{}" });
    expect(invalid.code).toBe(1);
    expect(invalid.output.errors[0]).toMatch(/id must be/);
    write(rulesYml(GOOD));
    expect(rulesEval({ projectDir: dir, tool: "Bash", input: "{not json" }).output.errors[0]).toMatch(/--input/);
    expect(rulesEval({ projectDir: dir, tool: "Bash", input: "[1]" }).code).toBe(1);
    expect(rulesEval({ projectDir: dir, input: "{}" }).output.errors[0]).toMatch(/--tool/);
  });

  it("with no rules.yml every call is allowed", () => {
    expect(rulesEval({ projectDir: dir, tool: SPRINT_TOOL, input: '{"allowLongSprint":true}' }).code).toBe(0);
  });
});
