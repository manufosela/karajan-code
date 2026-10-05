// KJC-TSK-0940 (MDR-D, ADR 0016): kj rules compile — the brief for whoever
// compiles the rules with no gate. kj calls no model: the host agent knows its
// own tools, proposes, and the user approves.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rulesCompileBrief } from "../../src/commands/rules-compile.js";
import { parseRules } from "../../src/rules/compiled.js";
import { listRules } from "../../src/rules/inventory.js";

let dir, home, rules;
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
});
afterEach(() => { for (const d of [dir, home]) fs.rmSync(d, { recursive: true, force: true }); });

describe("kj rules compile", () => {
  it("hands over every rule with no gate: its id, where it is written and what it says", () => {
    write([`{ id: ${rules[0].id}, kind: judgment, when: { tool: Bash } }`, "{ id: R-a1b2c3d4e5, kind: out-of-scope, reason: vieja }"]);
    const res = brief();
    expect(res.code).toBe(0);
    const text = res.lines.join("\n");
    // the source as a versioned file can carry it: no absolute path of this machine
    expect(text).toMatch(new RegExp(`${rules[1].id}  CLAUDE\\.md:2\\n\\s+Siempre responde claro\\.`));
    expect(text).not.toContain(dir);
    expect(text).not.toContain(`${rules[0].id}  `); // already compiled: not handed over again
    expect(text).toMatch(/drop.*R-a1b2c3d4e5/);
    for (const step of ["rules.proposed.yml", "kj rules check", "kj rules approve", "out-of-scope", "days_from"]) expect(text).toContain(step);
  });

  it("a rule of the user's global MD is shown from ~", () => {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "- Nunca toques otro repo.\n");
    const text = brief().lines.join("\n");
    expect(text).toMatch(/R-[0-9a-f]{10} {2}~\/\.claude\/CLAUDE\.md:1\n\s+Nunca toques otro repo\./);
    expect(text).not.toContain(home);
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
