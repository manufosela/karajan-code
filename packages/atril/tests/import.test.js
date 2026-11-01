// ADR 0021, decision 12 and plan step 11d: atril import --from openskills moves the skills
// OpenSkills installed into auto-loaded folders out of them, into atril's store.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importSkills } from "../src/import.js";
import { readLock } from "../src/lock.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
let dir;
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const skill = (name, extra = "") => `---\nname: ${name}\ndescription: ${name} things\n${extra}---\nbody\n`;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-import-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const o = () => ({ projectDir: dir, root: "store" });

describe("atril import --from openskills", () => {
  // HU-2781 (ADR 0039, decision 1): a Spanish skill is imported as it is and warned about once.
  it("warns once per imported skill that looks non-English, and not for an English one", () => {
    put(".claude/skills/lint/SKILL.md", skill("lint"));
    put(".claude/skills/probar/SKILL.md", "---\nname: probar\ndescription: Escribe la prueba para el login\n---\nbody\n");
    const warnings = [];
    importSkills("openskills", { ...o(), onWarning: (text) => warnings.push(text) });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^skill:probar: description look\(s\) non-English/);
  });

  it("moves each skill from .claude/skills and .agent/skills into the store, as kind skill", () => {
    put(".claude/skills/lint/SKILL.md", skill("lint"));
    put(".claude/skills/lint/rules.md", "rules");
    put(".agent/skills/fmt/SKILL.md", skill("fmt", "kind: skill\n"));
    expect(importSkills("openskills", o()).map(({ name, from }) => [name, from])).toEqual([
      ["lint", join(".claude", "skills", "lint")],
      ["fmt", join(".agent", "skills", "fmt")],
    ]);
    expect(readFileSync(join(dir, "store", "skills", "lint", "SKILL.md"), "utf8")).toBe(`---\nkind: skill\nname: lint\ndescription: lint things\n---\nbody\n`);
    expect(readFileSync(join(dir, "store", "skills", "lint", "rules.md"), "utf8")).toBe("rules");
    expect(existsSync(join(dir, ".claude", "skills", "lint"))).toBe(false);
    expect(existsSync(join(dir, ".agent", "skills", "fmt"))).toBe(false);
    expect(readLock(o()).artifacts["skill:lint"]).toEqual({ origin: "import", from: "openskills", hash: expect.stringMatching(/^sha256:/) });
  });

  it("keeps the original when the store holds a different skill of that name", () => {
    put("store/skills/lint/SKILL.md", skill("lint", "kind: skill\n").replace("body", "mine"));
    put(".claude/skills/lint/SKILL.md", skill("lint"));
    expect(() => importSkills("openskills", o())).toThrow(/skill:lint already exists .* different content/);
    expect(existsSync(join(dir, ".claude", "skills", "lint", "SKILL.md"))).toBe(true);
  });

  it("refuses a symlink before copying or rewriting anything, in the folder or as the folder", () => {
    put("outside/SKILL.md", skill("lint"));
    mkdirSync(join(dir, ".claude", "skills", "lint"), { recursive: true });
    symlinkSync(join(dir, "outside", "SKILL.md"), join(dir, ".claude", "skills", "lint", "SKILL.md"));
    expect(() => importSkills("openskills", o())).toThrow(/a skill may not hold symlinks/);
    rmSync(join(dir, ".claude", "skills", "lint"), { recursive: true });
    symlinkSync(join(dir, "outside"), join(dir, ".claude", "skills", "lint"));
    expect(() => importSkills("openskills", o())).toThrow(/may not be a symlink/);
    expect(readFileSync(join(dir, "outside", "SKILL.md"), "utf8")).toBe(skill("lint"));
  });

  it("names the sources it imports from, and runs from the CLI", () => {
    expect(() => importSkills("skillsmp", o())).toThrow(/atril imports from openskills, not "skillsmp"/);
    put(".claude/skills/lint/SKILL.md", skill("lint"));
    const res = spawnSync(process.execPath, [BIN, "import", "--from", "openskills", "--root", "store"], { cwd: dir, encoding: "utf8" });
    expect(res.stdout).toContain(`imported\tskill:lint\t${join(".claude", "skills", "lint")}`);
  });
});
