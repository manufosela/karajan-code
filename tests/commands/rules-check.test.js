// KJC-TSK-0950 (MDR-D1, ADR 0016): kj rules check — a proposal of compiled rules
// proves itself before a human reads it: every rule is one of the MD files, says
// what the MD says, and passes its own examples.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rulesCheck } from "../../src/commands/rules.js";
import { listRules } from "../../src/rules/inventory.js";

const PROPOSAL = path.join(".karajan", "rules.proposed.yml");
const EXAMPLES = "examples: { deny: [{ tool: Bash, input: { command: deploy } }], allow: [{ tool: Bash, input: { command: ls } }] }";
const WHEN = "when: { tool: Bash, all: [{ arg: command, matches: deploy }] }";

let dir, home, rule;
const propose = (rules) => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, PROPOSAL), `version: 1\nrules:\n${rules.map((r) => `  - ${r}\n`).join("")}`);
};
const check = () => rulesCheck({ projectDir: dir, file: PROPOSAL, home });
const text = () => check().lines.join("\n");
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-check-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-check-home-"));
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "- Nunca despliegues sin permiso.\n- Siempre responde claro.\n");
  [rule] = listRules(dir, { home });
});
afterEach(() => { for (const d of [dir, home]) fs.rmSync(d, { recursive: true, force: true }); });

describe("kj rules check", () => {
  it("a proposal that says what the MD says and passes its examples is ready", () => {
    propose([`{ id: ${rule.id}, text: "${rule.text}", kind: deterministic, ${WHEN}, ${EXAMPLES} }`]);
    const res = check();
    expect(res.code).toBe(0);
    expect(res.lines.join("\n")).toMatch(/1 rule\(s\).*1 deterministic/);
  });

  it("names a rule that is in no MD, one whose text is not the MD's, and one with no text", () => {
    propose([`{ id: R-a1b2c3d4e5, text: "Inventada.", kind: judgment, when: { tool: Bash } }`]);
    expect(text()).toMatch(/R-a1b2c3d4e5.*no rule of the MD files/);
    propose([`{ id: ${rule.id}, text: "Nunca despliegues.", kind: judgment, when: { tool: Bash } }`]);
    expect(text()).toMatch(new RegExp(`${rule.id}.*text is not what the MD says.*Nunca despliegues sin permiso\\.`));
    propose([`{ id: ${rule.id}, kind: judgment, when: { tool: Bash } }`]);
    expect(check()).toMatchObject({ code: 1 });
  });

  it("a deterministic rule answers to its own examples; a repeated id is one rule compiled twice", () => {
    propose([`{ id: ${rule.id}, text: "${rule.text}", kind: deterministic, ${WHEN} }`]);
    expect(text()).toMatch(/needs examples/);
    const same = `{ id: ${rule.id}, text: "${rule.text}", kind: judgment, when: { tool: Bash } }`;
    propose([same, same]);
    expect(check().code).toBe(1);
    expect(text()).toMatch(/repeated/);
  });

  it("no proposal, or one that does not parse, is an error", () => {
    expect(check()).toMatchObject({ code: 1 });
    expect(text()).toMatch(/rules\.proposed\.yml/);
    propose(["{ id: bad }"]);
    expect(text()).toMatch(/id must be/);
  });
});
