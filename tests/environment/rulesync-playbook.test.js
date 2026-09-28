// KJC-TSK-0879 (issue #1310): el playbook de kj env install, como las
// guidelines de kj harden, va a la fuente de Rulesync cuando el repo lo usa;
// escrito en CLAUDE.md/AGENTS.md/GEMINI.md lo borraria el siguiente generate.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installPlaybook } from "../../src/environment/playbook.js";
import { installGuidelines } from "../../src/harden/guidelines-engine.js";
import { RULESYNC_RULE } from "../../src/utils/rulesync.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-rs-play-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("kj env install con Rulesync", () => {
  it("el playbook va a .rulesync/rules/karajan.md, sea cual sea el target", async () => {
    mkdirSync(join(dir, ".rulesync"));
    const res = await installPlaybook({ projectDir: dir, target: "all" });
    expect(res.files).toEqual([RULESYNC_RULE]);
    expect(readFileSync(join(dir, RULESYNC_RULE), "utf8")).toMatch(/^---\nroot: false/);
    for (const f of ["CLAUDE.md", "AGENTS.md", "GEMINI.md"]) expect(existsSync(join(dir, f))).toBe(false);
  });

  it("playbook y guidelines conviven en el mismo fichero, cada uno en su bloque", async () => {
    mkdirSync(join(dir, ".rulesync"));
    await installPlaybook({ projectDir: dir, target: "all" });
    installGuidelines({ projectDir: dir, language: "javascript" });
    const text = readFileSync(join(dir, RULESYNC_RULE), "utf8");
    expect(text).toContain(">>> kj:managed:playbook v");
    expect(text).toContain(">>> kj:managed:guidelines v");
    expect(text.match(/^---$/gm)).toHaveLength(2); // un solo frontmatter
    expect((await installPlaybook({ projectDir: dir, target: "all" })).files).toEqual([RULESYNC_RULE]);
  });

  it("sin Rulesync, el target decide como siempre", async () => {
    const res = await installPlaybook({ projectDir: dir, target: "claude" });
    expect(res.files).toEqual(["CLAUDE.md"]);
  });
});
