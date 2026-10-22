// KJC-TSK-0879 (issue #1310): en un repo gestionado con Rulesync, la fuente de
// verdad de las reglas es .rulesync/rules/ y `rulesync generate` reescribe
// CLAUDE.md/AGENTS.md. Si kj escribe alli, el siguiente generate borra su bloque.
// Con Rulesync detectado, kj escribe en .rulesync/rules/karajan.md.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installGuidelines } from "../../src/harden/guidelines-engine.js";
import { installPlaybook } from "../../src/environment/playbook.js";
import { detectRulesync, RULESYNC_RULE, writeRulesyncBlock } from "../../src/utils/rulesync.js";
import { LEDGER_FILE, readLedger } from "../../src/utils/rulesync-ledger.js";

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

// HU-0002 (ADR 0022, decision 3): kj writes its blocks of karajan.md through
// the ownership ledger. It owns its managed blocks, not the file: the team's
// own rules outside them stay free, a hand edit inside one stops kj.
describe("kj's karajan.md blocks through the ownership ledger", () => {
  const withRulesync = () => mkdirSync(join(dir, ".rulesync"));
  const key = "rules/karajan.md#guidelines";

  it("records kj as the owner of the block it wrote, with its hash", () => {
    withRulesync();
    installGuidelines({ projectDir: dir, language: "javascript" });
    expect(readLedger(dir).entries[key]).toMatchObject({ owner: "kj", hash: expect.stringMatching(/^sha256:/) });
  });

  it("claims, once and saying so, a block written before the ledger existed", () => {
    withRulesync();
    installGuidelines({ projectDir: dir, language: "javascript" });
    rmSync(join(dir, LEDGER_FILE));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = installGuidelines({ projectDir: dir, language: "javascript" });
    expect(res.guidelines[0].claimed).toBe(true);
    expect(info.mock.calls.join(" ")).toMatch(/claimed .*rules\/karajan\.md#guidelines/);
    expect(readLedger(dir).entries[key].owner).toBe("kj");
    info.mockClear();
    installGuidelines({ projectDir: dir, language: "javascript" });
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("a hand edit inside its block stops kj, gives a remedy that works today, and leaves the file as it was", () => {
    withRulesync();
    installGuidelines({ projectDir: dir, language: "javascript" });
    const edited = readFileSync(rule(), "utf8").replace(/(>>> kj:managed:guidelines v\d+ >>>[^\n]*\n)/, "$1- my own line inside\n");
    writeFileSync(rule(), edited);
    expect(() => installGuidelines({ projectDir: dir, language: "javascript" })).toThrow(/edited by hand.*restore kj's block.*kj rulesync adopt rules\/karajan\.md#guidelines/i);
    expect(readFileSync(rule(), "utf8")).toBe(edited);
  });

  it("rewrites its own block when its body changes, and records the new hash", () => {
    withRulesync();
    installGuidelines({ projectDir: dir, language: "javascript" });
    const before = readLedger(dir).entries[key].hash;
    expect(() => installGuidelines({ projectDir: dir, language: "python" })).not.toThrow();
    expect(readFileSync(rule(), "utf8")).toMatch(/python/i);
    expect(readLedger(dir).entries[key].hash).not.toBe(before);
  });

  it("a render that drops the block fails naming the file and the block", () => {
    withRulesync();
    expect(() => writeRulesyncBlock({ projectDir: dir, blockId: "guidelines", render: () => ({ content: "x\n" }) }))
      .toThrow(/karajan\.md.*guidelines/);
  });

  it.each([
    ["deleted", (text) => text.replace(/<!-- >>> kj:managed:guidelines[\s\S]*?<<< kj:managed:guidelines <<< -->\n?/, "")],
    ["left without its closing marker", (text) => text.replace(/<!-- <<< kj:managed:guidelines <<< -->/, "")],
  ])("an owned block %s by hand stops kj too", (_label, edit) => {
    withRulesync();
    installGuidelines({ projectDir: dir, language: "javascript" });
    const edited = edit(readFileSync(rule(), "utf8"));
    writeFileSync(rule(), edited);
    expect(() => installGuidelines({ projectDir: dir, language: "javascript" })).toThrow(/edited by hand/);
    expect(readFileSync(rule(), "utf8")).toBe(edited);
  });

  it("the playbook block is recorded under its own key", async () => {
    withRulesync();
    await installPlaybook({ projectDir: dir });
    expect(readLedger(dir).entries["rules/karajan.md#playbook"].owner).toBe("kj");
  });
});
