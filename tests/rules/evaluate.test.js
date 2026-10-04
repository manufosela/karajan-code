// KJC-TSK-0944 (MDR-B1, ADR 0016): one tool call against the compiled rules,
// with no model. A deny cites the rule; judgment rules are left to the judge.
import { describe, it, expect } from "vitest";
import { parseRules } from "../../src/rules/compiled.js";
import { evalRules } from "../../src/rules/evaluate.js";

const rulesOf = (text) => {
  const { rules, errors } = parseRules(text);
  expect(errors).toEqual([]);
  return rules;
};

const SPRINT = rulesOf(`
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
    message: "Un sprint dura un día."
  - id: R-0000000002
    text: "No preguntes obviedades."
    kind: judgment
    when: { tool: AskUserQuestion }
`);
const sprint = (input) => ({ tool: "mcp__planning-game-personal__create_sprint", input });

describe("evalRules", () => {
  it("denies the call a rule's conditions match, citing the rule", () => {
    const v = evalRules(SPRINT, sprint({ startDate: "2026-10-05", endDate: "2026-10-11" }));
    expect(v).toEqual({ decision: "deny", rule_id: "R-0000000001", source: "CLAUDE.md", text: "Sprints: uno por día.", message: "Un sprint dura un día." });
    expect(evalRules(SPRINT, sprint({ startDate: "2026-10-05", allowLongSprint: true })).decision).toBe("deny");
  });

  it("allows what no rule matches: another tool, a one-day sprint at any hour, a missing or unreadable argument", () => {
    expect(evalRules(SPRINT, sprint({ startDate: "2026-10-05", endDate: "2026-10-05" })).decision).toBe("allow");
    expect(evalRules(SPRINT, sprint({ startDate: "2026-10-05T00:00:00Z", endDate: "2026-10-05T23:59:59Z" })).decision).toBe("allow");
    expect(evalRules(SPRINT, sprint({ startDate: "2026-10-05" })).decision).toBe("allow");
    expect(evalRules(SPRINT, sprint({ startDate: "soon", endDate: "later" })).decision).toBe("allow");
    expect(evalRules(SPRINT, { tool: "mcp__planning-game-personal__list_sprints", input: {} }).decision).toBe("allow");
    expect(evalRules(SPRINT, sprint(undefined)).decision).toBe("allow");
  });

  it("leaves judgment rules to the judge", () => {
    expect(evalRules(SPRINT, { tool: "AskUserQuestion", input: {} }).decision).toBe("allow");
  });

  it("a tool glob is literal except for *: a dot is a dot", () => {
    const r = rulesOf("version: 1\nrules:\n  - { id: R-0000000004, kind: deterministic, when: { tool: 'mcp__a.b__*' } }");
    expect(evalRules(r, { tool: "mcp__a.b__write", input: {} })).toMatchObject({ decision: "deny", source: null, message: "rule R-0000000004" });
    expect(evalRules(r, { tool: "mcp__aXb__write", input: {} }).decision).toBe("allow");
  });

  it("reads dotted paths and every operator: in, matches, exists, lt, all + any together", () => {
    const r = rulesOf(`
version: 1
rules:
  - id: R-0000000003
    kind: deterministic
    when:
      tool: [Bash, "mcp__x__*"]
      all:
        - { arg: updates.status, in: [Done, Closed] }
        - { arg: updates.commits, exists: false }
      any:
        - { arg: command, matches: "^git push" }
        - { arg: updates.points, lt: 3 }
`);
    const call = (input) => evalRules(r, { tool: "mcp__x__update", input }).decision;
    expect(call({ updates: { status: "Done", points: 1 } })).toBe("deny");
    expect(call({ updates: { status: "Done", points: 5 } })).toBe("allow");
    expect(call({ updates: { status: "Done", points: 1, commits: [] } })).toBe("allow");
    expect(call({ updates: { status: "To Do", points: 1 } })).toBe("allow");
    expect(evalRules(r, { tool: "Bash", input: { command: "git push origin x", updates: { status: "Closed" } } }).decision).toBe("deny");
  });

  it("compares numbers only, and reads own properties only", () => {
    const r = rulesOf(`
version: 1
rules:
  - { id: R-0000000005, kind: deterministic, when: { tool: T, all: [{ arg: points, lt: 3 }] } }
  - { id: R-0000000006, kind: deterministic, when: { tool: U, all: [{ arg: constructor, exists: true }] } }
`);
    expect(evalRules(r, { tool: "T", input: { points: "" } }).decision).toBe("allow");
    expect(evalRules(r, { tool: "T", input: { points: 1 } }).decision).toBe("deny");
    expect(evalRules(r, { tool: "U", input: {} }).decision).toBe("allow");
  });
});
