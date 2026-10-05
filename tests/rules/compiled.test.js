// KJC-TSK-0938 (MDR-B, ADR 0016): the format of compiled rules — a closed set of
// operators over a tool call. An invalid file yields errors and no rules.
import { describe, it, expect } from "vitest";
import { parseRules } from "../../src/rules/compiled.js";

const SPRINT_RULE = `
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
    source: CLAUDE.md
    text: "No preguntes obviedades."
    kind: judgment
    when: { tool: AskUserQuestion }
`;
const load = (text) => parseRules(text);

describe("parseRules", () => {
  it("accepts a valid file", () => {
    const { rules, errors } = load(SPRINT_RULE);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(2);
  });

  it("names what is wrong: bad yaml, version, id, kind, operator, regex, missing tool", () => {
    expect(load(": : :").errors[0]).toMatch(/yaml/i);
    expect(load("version: 2\nrules: []").errors[0]).toMatch(/version/);
    const bad = (rule) => load(`version: 1\nrules:\n  - ${rule}`).errors.join(" | ");
    expect(bad("{ id: nope, kind: deterministic, when: { tool: Bash } }")).toMatch(/id/);
    expect(bad("{ id: R-0000000001, kind: maybe, when: { tool: Bash } }")).toMatch(/kind/);
    expect(bad("{ id: R-0000000001, kind: deterministic, when: {} }")).toMatch(/tool/);
    expect(bad("{ id: R-0000000001, kind: deterministic, when: { tool: Bash, all: [{ arg: command, contains: x }] } }")).toMatch(/operator/);
    expect(bad("{ id: R-0000000001, kind: deterministic, when: { tool: Bash, all: [{ arg: command, matches: '(' }] } }")).toMatch(/regex/);
    expect(bad("{ id: R-0000000001, kind: deterministic, when: { tool: Bash, all: [{ equals: 1 }] } }")).toMatch(/arg/);
    expect(bad("{ id: R-0000000001, kind: deterministic, when: { tool: Bash, all: { arg: x, equals: 1 } } }")).toMatch(/lists of conditions/);
    expect(bad("{ id: R-0000000001, kind: deterministic, when: { tool: Bash, any: [{ arg: d, days_from: s, equals: 1 }] } }")).toMatch(/days_from/);
  });

  it("the format is closed: an unread key or a wrong operand invalidates the rule", () => {
    const bad = (rule) => load(`version: 1\nrules:\n  - ${rule}`).errors.join(" | ");
    const cond = (c) => bad(`{ id: R-0000000001, kind: deterministic, when: { tool: Bash, all: [${c}] } }`);
    expect(cond("{ arg: command, equals: x, contains: y }")).toMatch(/unknown key contains/);
    expect(cond("{ arg: command, exists: yes please }")).toMatch(/operand for exists/);
    expect(cond("{ arg: points, gt: many }")).toMatch(/operand for gt/);
    expect(cond("{ arg: status, in: Done }")).toMatch(/operand for in/);
    expect(cond("{ arg: endDate, days_from: '', gt: 0 }")).toMatch(/days_from/);
    expect(cond("{ arg: 'updates..status', equals: x }")).toMatch(/needs an `arg`/);
    expect(bad("{ id: R-0000000001, kind: deterministic, when: { tool: [Bash, 42] } }")).toMatch(/when\.tool/);
    expect(bad("{ id: R-0000000001, kind: deterministic, when: { tool: [] } }")).toMatch(/when\.tool/);
    expect(bad("{ id: R-0000000001, kind: deterministic, when: { tool: Bash, alll: [] } }")).toMatch(/unknown key when\.alll/);
    expect(bad("{ id: R-0000000001, kind: deterministic, when: { tool: Bash }, severity: high }")).toMatch(/unknown key severity/);
    expect(bad("{ id: R-0000000001, kind: deterministic, when: { tool: Bash }, message: [a] }")).toMatch(/message must be text/);
    expect(load("version: 1\nmode: strict\nrules: []").errors[0]).toMatch(/unknown key mode/);
  });

  // KJC-TSK-0948 (MDR-E1): a rule about how the agent thinks or answers has no
  // tool call to gate. Saying so, with the reason, is a decision; silence is not.
  it("an out-of-scope rule carries its reason and nothing to evaluate", () => {
    const rule = (rest) => load(`version: 1\nrules:\n  - { id: R-a1b2c3d4e5, kind: out-of-scope${rest} }`);
    expect(rule(", source: CLAUDE.md, text: Habla claro., reason: no es una acción")).toMatchObject({ errors: [], rules: [{ kind: "out-of-scope" }] });
    expect(rule("").errors.join()).toMatch(/R-a1b2c3d4e5.*reason/);
    expect(rule(", reason: ''").errors.join()).toMatch(/reason/);
    expect(rule(", reason: [a]").errors.join()).toMatch(/reason/);
    for (const key of ["when: { tool: Bash }", "message: no", "examples: {}"]) {
      expect(rule(`, reason: no es una acción, ${key}`).errors.join()).toMatch(/out-of-scope rule takes no/);
    }
  });

  // KJC-TSK-0973: a judgment rule may say why it takes no condition; the reviewer
  // and the human read it. A condition needs no excuse.
  it("a judgment rule may carry its reason; a deterministic one may not", () => {
    const rule = (rest) => load(`version: 1\nrules:\n  - { id: R-a1b2c3d4e5, ${rest} }`).errors.join();
    expect(rule("kind: judgment, when: { tool: Bash }, reason: lo que la rompe está en un fichero")).toBe("");
    expect(rule("kind: judgment, when: { tool: Bash }")).toBe("");
    expect(rule("kind: judgment, when: { tool: Bash }, reason: ''")).toMatch(/reason is text/);
    expect(rule("kind: judgment, when: { tool: Bash }, reason: [a]")).toMatch(/reason is text/);
    expect(rule("kind: deterministic, when: { tool: Bash }, reason: porque sí")).toMatch(/a condition needs no excuse/);
  });

  it("any error leaves no rules: an invalid file evaluates nothing", () => {
    const text = `${SPRINT_RULE}  - { id: bad, kind: deterministic, when: { tool: Bash } }\n`;
    expect(load(text).rules).toEqual([]);
  });
});
