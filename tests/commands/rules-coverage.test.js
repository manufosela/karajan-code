// KJC-TSK-0941 (MDR-E, ADR 0016): kj rules coverage — every rule of the MD files
// against .karajan/rules.yml. A rule with no gate is seen, not silently missing.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rulesCoverage } from "../../src/commands/rules.js";
import { listRules } from "../../src/rules/inventory.js";
import { coverage } from "../../src/rules/coverage.js";

const MD = "# Reglas\n- Nunca sprints de una semana.\n- Siempre responde claro.\n- Nunca preguntes obviedades.\n- Nunca despliegues sin permiso.\n";

let dir, home, ids;
const write = (rules) => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "rules.yml"), `version: 1\nrules:\n${rules.map((r) => `  - ${r}\n`).join("")}`);
};
const run = (opts = {}) => rulesCoverage({ projectDir: dir, home, ...opts });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-cov-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-cov-home-"));
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), MD);
  ids = listRules(dir, { home }).map((r) => r.id);
});
afterEach(() => { for (const d of [dir, home]) fs.rmSync(d, { recursive: true, force: true }); });

describe("coverage", () => {
  it("a rule is what its compilation says, or has no gate; a compiled rule in no MD is stale", () => {
    const inventory = [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "a", text: "A" }];
    const { rows, stale } = coverage(inventory, [{ id: "a", kind: "judgment" }, { id: "z", kind: "deterministic", text: "Z" }]);
    expect(rows.map((r) => [r.id, r.status])).toEqual([["a", "judgment"], ["b", "none"]]);
    expect(stale).toEqual([{ id: "z", kind: "deterministic", text: "Z" }]);
  });
});

describe("kj rules coverage", () => {
  it("counts each status and names the rules with no gate and the stale ones", () => {
    write([
      `{ id: ${ids[0]}, kind: deterministic, when: { tool: Bash } }`,
      `{ id: ${ids[1]}, kind: out-of-scope, reason: no es una acción }`,
      `{ id: ${ids[2]}, kind: judgment, when: { tool: AskUserQuestion } }`,
      "{ id: R-a1b2c3d4e5, kind: deterministic, source: CLAUDE.md, text: Texto viejo., when: { tool: Bash } }",
    ]);
    const res = run();
    expect(res.code).toBe(0);
    expect(res.output.counts).toEqual({ deterministic: 1, judgment: 1, "out-of-scope": 1, none: 1, stale: 1 });
    const text = res.lines.join("\n");
    expect(text).toMatch(new RegExp(`no gate.*${ids[3]}.*CLAUDE\\.md:5.*Nunca despliegues`));
    expect(text).toMatch(/stale.*R-a1b2c3d4e5.*Texto viejo/);
    expect(text).not.toContain(ids[0]);
  });

  it("--strict fails while a rule has no gate or a compiled one is stale", () => {
    expect(run({ strict: true }).code).toBe(1); // no rules.yml: every rule is ungated
    expect(run().code).toBe(0);
    write(ids.map((id) => `{ id: ${id}, kind: out-of-scope, reason: decidido }`));
    expect(run({ strict: true })).toMatchObject({ code: 0, output: { counts: { none: 0, stale: 0 } } });
    write([...ids.map((id) => `{ id: ${id}, kind: out-of-scope, reason: decidido }`), "{ id: R-a1b2c3d4e5, kind: out-of-scope, reason: viejo }"]);
    expect(run({ strict: true }).code).toBe(1);
  });

  it("an invalid rules.yml is an error, never a coverage of nothing", () => {
    write(["{ id: bad, kind: deterministic, when: { tool: Bash } }"]);
    const res = run();
    expect(res.code).toBe(1);
    expect(res.lines.join()).toMatch(/id must be/);
  });
});
