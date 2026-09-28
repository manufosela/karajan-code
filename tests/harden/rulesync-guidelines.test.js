// KJC-TSK-0879 (issue #1310): en un repo gestionado con Rulesync, la fuente de
// verdad de las reglas es .rulesync/rules/ y `rulesync generate` reescribe
// CLAUDE.md/AGENTS.md. Si kj escribe alli, el siguiente generate borra su bloque.
// Con Rulesync detectado, kj escribe en .rulesync/rules/karajan.md.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installGuidelines } from "../../src/harden/guidelines-engine.js";
import { detectRulesync, RULESYNC_RULE } from "../../src/utils/rulesync.js";

let dir;
const rule = () => join(dir, RULESYNC_RULE);
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-rulesync-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("detectRulesync", () => {
  it("detecta .rulesync/ o rulesync.jsonc, y nada mas", () => {
    expect(detectRulesync(dir)).toBe(false);
    writeFileSync(join(dir, "rulesync.jsonc"), "{}\n");
    expect(detectRulesync(dir)).toBe(true);
    rmSync(join(dir, "rulesync.jsonc"));
    mkdirSync(join(dir, ".rulesync"));
    expect(detectRulesync(dir)).toBe(true);
  });
});

describe("kj harden guidelines con Rulesync", () => {
  it("sin Rulesync, nada cambia: CLAUDE.md y AGENTS.md, y ningun fichero de Rulesync", () => {
    installGuidelines({ projectDir: dir, language: "javascript" });
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(rule())).toBe(false);
  });

  it("con Rulesync, el bloque va a .rulesync/rules/karajan.md con su frontmatter, y no toca CLAUDE.md", () => {
    mkdirSync(join(dir, ".rulesync"));
    const res = installGuidelines({ projectDir: dir, language: "javascript" });
    expect(res.guidelines.map((g) => g.file)).toEqual([RULESYNC_RULE]);
    const text = readFileSync(rule(), "utf8");
    expect(text).toMatch(/^---\nroot: false\ntargets: \["\*"\]\n/);
    expect(text).toContain(">>> kj:managed:guidelines v1 >>>");
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
  });

  it("idempotente, y lo que el equipo escribe fuera del bloque se queda", () => {
    mkdirSync(join(dir, ".rulesync"));
    installGuidelines({ projectDir: dir, language: "javascript" });
    writeFileSync(rule(), `${readFileSync(rule(), "utf8")}\n- Regla propia del equipo.\n`);
    const again = installGuidelines({ projectDir: dir, language: "javascript" });
    expect(again.guidelines[0].action).toBe("unchanged");
    expect(readFileSync(rule(), "utf8")).toContain("- Regla propia del equipo.");
  });
});
