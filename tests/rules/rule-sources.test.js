// KJC-TSK-0942 (MDR-A2, ADR 0016): which MD files govern a session, and the
// rules they hold.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ruleSources, listRules } from "../../src/rules/inventory.js";

describe("ruleSources / listRules", () => {
  let project, home;
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), "kj_rules.proj-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-home-"));
  });
  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("reads the project's CLAUDE.md and AGENTS.md, the global CLAUDE.md and the project's feedback memories", () => {
    fs.writeFileSync(path.join(project, "CLAUDE.md"), "- NUNCA hagas push a main.\n");
    fs.writeFileSync(path.join(project, "AGENTS.md"), "- Always run the tests.\n");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "- PROHIBIDO usar alert().\n");
    // Claude Code's folder name for the project: every non-alphanumeric char as "-" ("_" and "." included).
    const memory = path.join(home, ".claude", "projects", project.replaceAll(/[^A-Za-z0-9]/g, "-"), "memory");
    fs.mkdirSync(memory, { recursive: true });
    fs.writeFileSync(path.join(memory, "feedback_x.md"), "Nunca escribir hashes de memoria.\n");
    fs.writeFileSync(path.join(memory, "project_y.md"), "Never mind this one.\n");
    const files = ruleSources(project, { home });
    expect(files.map((f) => path.basename(f))).toEqual(["CLAUDE.md", "AGENTS.md", "CLAUDE.md", "feedback_x.md"]);
    const rules = listRules(project, { home });
    expect(rules).toHaveLength(4);
    expect(rules.every((r) => path.isAbsolute(r.file))).toBe(true);
  });

  it("a project with no governing MD file has no rules", () => {
    expect(ruleSources(project, { home })).toEqual([]);
    expect(listRules(project, { home })).toEqual([]);
  });
});
