// KJC-TSK-0940 (MDR-D, ADR 0016): kj rules compile — the brief for whoever
// compiles the rules with no gate. kj calls no model: the host agent knows its
// own tools, proposes, and the user approves.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { rulesCheck } from "../../src/commands/rules.js";
import { rulesCompileBrief } from "../../src/commands/rules-compile.js";
import { parseRules } from "../../src/rules/compiled.js";
import { listRules } from "../../src/rules/inventory.js";

let dir, home, rules, PROPOSAL;
const proposal = () => yaml.load(fs.readFileSync(PROPOSAL, "utf8")).rules;
const write = (entries) => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "rules.yml"), `version: 1\nrules:\n${entries.map((e) => `  - ${e}\n`).join("")}`);
};
const brief = () => rulesCompileBrief({ projectDir: dir, home });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-compile-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-compile-home-"));
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "- Nunca despliegues sin permiso.\n- Siempre responde claro.\n");
  rules = listRules(dir, { home });
  PROPOSAL = path.join(dir, ".karajan", "rules.proposed.yml");
});
afterEach(() => { for (const d of [dir, home]) fs.rmSync(d, { recursive: true, force: true }); });

describe("kj rules compile", () => {
  // KJC-TSK-0953: kj writes the skeleton. Nobody retypes a hundred literal texts,
  // where one changed character voids the rule.
  it("writes the proposal: what rules.yml holds, minus the stale, plus one entry per rule with no gate", () => {
    write([`{ id: ${rules[0].id}, kind: judgment, when: { tool: Bash } }`, "{ id: R-a1b2c3d4e5, kind: out-of-scope, reason: vieja }"]);
    const res = brief();
    expect(res.code).toBe(0);
    expect(proposal()).toEqual([
      { id: rules[0].id, kind: "judgment", when: { tool: "Bash" } },
      // the source as a versioned file can carry it: no absolute path of this machine
      { id: rules[1].id, source: "CLAUDE.md", text: "Siempre responde claro." },
    ]);
    const text = res.lines.join("\n");
    expect(text).toMatch(/1 entr.* no kind/);
    expect(text).toMatch(/left out.*R-a1b2c3d4e5/i);
    for (const step of ["rules.proposed.yml", "kj rules check", "kj rules approve", "out-of-scope", "days_from"]) expect(text).toContain(step);
    // the skeleton is not a proposal yet: every entry needs its kind
    expect(rulesCheck({ projectDir: dir, home }).lines.join()).toMatch(new RegExp(`${rules[1].id}.*kind must be`));
  });

  it("run again, it keeps what is already filled in and adds only the rules that are missing", () => {
    brief();
    const filled = proposal().map((entry) => ({ ...entry, kind: "out-of-scope", reason: "decidido" }));
    fs.writeFileSync(PROPOSAL, yaml.dump({ version: 1, rules: filled }));
    fs.appendFileSync(path.join(dir, "CLAUDE.md"), "- Nunca toques otro repo.\n");
    expect(brief().lines.join("\n")).toMatch(/1 entr.* no kind/);
    expect(proposal()).toEqual([...filled, { id: expect.stringMatching(/^R-/), source: "CLAUDE.md", text: "Nunca toques otro repo." }]);
    fs.writeFileSync(PROPOSAL, ": : :");
    expect(brief()).toMatchObject({ code: 1, lines: [expect.stringMatching(/not valid YAML/)] });
  });

  it("a proposal that forgot an approved rule gets it back, and loses the stale: approving it removes no gate", () => {
    const approved = `{ id: ${rules[0].id}, kind: judgment, when: { tool: Bash } }`;
    write([approved, "{ id: R-a1b2c3d4e5, kind: out-of-scope, reason: vieja }"]);
    const mine = { id: rules[1].id, source: "CLAUDE.md", text: rules[1].text, kind: "out-of-scope", reason: "decidido" };
    fs.writeFileSync(PROPOSAL, yaml.dump({ version: 1, rules: [mine, { id: "R-a1b2c3d4e5", kind: "out-of-scope", reason: "vieja" }] }));
    brief();
    expect(proposal()).toEqual([{ id: rules[0].id, kind: "judgment", when: { tool: "Bash" } }, mine]);
  });

  it("a rule of the user's global MD is written from ~", () => {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "- Nunca toques otro repo.\n");
    brief();
    expect(proposal()).toContainEqual({ id: expect.any(String), source: "~/.claude/CLAUDE.md", text: "Nunca toques otro repo." });
    expect(fs.readFileSync(PROPOSAL, "utf8")).not.toContain(home);
  });

  it("the example in the brief is a rule the format accepts", () => {
    const text = brief().lines.join("\n");
    const example = /```yaml\n([\s\S]*?)```/.exec(text)[1];
    expect(parseRules(example)).toMatchObject({ errors: [] });
  });

  it("with every rule decided there is nothing to compile; an invalid rules.yml is an error", () => {
    write(rules.map((r) => `{ id: ${r.id}, kind: out-of-scope, reason: decidido }`));
    expect(brief()).toMatchObject({ code: 0, lines: [expect.stringMatching(/nothing to compile/)] });
    write(["{ id: bad }"]);
    expect(brief().code).toBe(1);
  });
});
