// KJC-BUG-0592: registering a human act with kj handoff add is not running it.
import { describe, it, expect } from "vitest";
import { parseRules } from "../../src/rules/compiled.js";
import { blankHandoffAdd, evalRules } from "../../src/rules/evaluate.js";

const rulesFor = (matches) => {
  const { rules, errors } = parseRules(`
version: 1
rules:
  - id: R-0000000009
    text: "Human acts"
    kind: deterministic
    when:
      tool: Bash
      all:
        - { arg: command, matches: "${matches}" }
`);
  expect(errors).toEqual([]);
  return rules;
};
const HARDEN = rulesFor("kj harden --commit");
const verdict = (rules, command) => evalRules(rules, { tool: "Bash", input: { command } }).decision;

describe("evalRules, kj handoff add (KJC-BUG-0592)", () => {
  it("allows registering the act, in single or double quotes, kj or node bin/kj.js", () => {
    expect(verdict(HARDEN, `kj handoff add 'cd /x && kj harden --commit' --why "seal"`)).toBe("allow");
    expect(verdict(HARDEN, `kj handoff add "cd /x && kj harden --commit" --why 'seal'`)).toBe("allow");
    expect(verdict(HARDEN, `cd /lane && node bin/kj.js handoff add 'kj harden --commit' --why "kj harden --commit"`)).toBe("allow");
  });

  it("allows a double-quoted registration whose escapes the shell keeps literal: \\\" \\$ \\`", () => {
    expect(verdict(HARDEN, String.raw`kj handoff add "echo \"done\" && kj harden --commit" --why x`)).toBe("allow");
    expect(verdict(HARDEN, String.raw`kj handoff add "echo \$(date) \`id\` && kj harden --commit" --why "say \"seal\""`)).toBe("allow");
  });

  it("still denies running the act, also after a registration", () => {
    expect(verdict(HARDEN, "kj harden --commit")).toBe("deny");
    expect(verdict(HARDEN, `kj handoff add 'x' --why y && kj harden --commit`)).toBe("deny");
  });

  it("still denies when the registration itself runs the act: $( ) or a backtick the shell expands", () => {
    expect(verdict(HARDEN, `kj handoff add "$(kj harden --commit)" --why x`)).toBe("deny");
    expect(verdict(HARDEN, "kj handoff add \"`kj harden --commit`\"")).toBe("deny");
    expect(verdict(HARDEN, `kj handoff add 'x' --why "$(kj harden --commit)"`)).toBe("deny");
    expect(verdict(HARDEN, `kj handoff add 'x' --why y$(kj harden --commit)`)).toBe("deny");
    expect(verdict(HARDEN, String.raw`kj handoff add "\\$(kj harden --commit)" --why x`)).toBe("deny");
  });

  it("a rule targeting kj handoff add itself still sees it", () => {
    expect(verdict(rulesFor("kj handoff add"), `kj handoff add 'x' --why "y"`)).toBe("deny");
  });
});

describe("blankHandoffAdd (KJC-BUG-0592)", () => {
  it("blanks each registered command and the --why that follows it, nothing else", () => {
    expect(blankHandoffAdd(`kj handoff add 'cd /x && kj harden --commit' --why "seal it"`)).toBe("kj handoff add '_' --why '_'");
    expect(blankHandoffAdd(`kj handoff add "a" --why seal; kj handoff add 'kj handoff add "b"' && ls`))
      .toBe("kj handoff add '_' --why '_'; kj handoff add '_' && ls");
    expect(blankHandoffAdd("kj handoff add --cwd /x 'kj harden --commit'")).toBe("kj handoff add --cwd /x 'kj harden --commit'");
    expect(blankHandoffAdd(String.raw`kj handoff add "say \"hi\" \\" --why "a \"b\""; ls`)).toBe("kj handoff add '_' --why '_'; ls");
  });
});
