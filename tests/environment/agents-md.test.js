import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handWritten, migrateLegacyAgentFiles } from "../../src/environment/agents-md.js";

let dir;
const read = (f) => readFileSync(join(dir, f), "utf8");
const write = (f, text) => writeFileSync(join(dir, f), text);
const block = (id, body) => `<!-- >>> kj:managed:${id} v1 >>> (note) -->\n${body}\n<!-- <<< kj:managed:${id} <<< -->`;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-agents-md-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("handWritten (KJC-TSK-1504)", () => {
  it("keeps what a person wrote and drops every kj block", () => {
    const text = `# Mine\n\n${block("playbook", "method")}\n${block("guidelines", "rules")}\n\nMy note.\n`;
    expect(handWritten(text)).toBe("# Mine\n\n\nMy note.");
  });

  it("a file with only kj blocks has nothing hand-written", () => {
    expect(handWritten(`${block("playbook", "method")}\n`)).toBe("");
  });
});

describe("migrateLegacyAgentFiles (KJC-TSK-1504)", () => {
  it("moves the hand-written paragraphs of CLAUDE.md and GEMINI.md into AGENTS.md and removes them", () => {
    write("AGENTS.md", `# Shared\n\n${block("playbook", "method")}\n`);
    write("CLAUDE.md", `# Shared\n\nOnly Claude knew this.\n\n${block("playbook", "method")}\n`);
    write("GEMINI.md", `${block("playbook", "method")}\n`);
    const res = migrateLegacyAgentFiles({ projectDir: dir });
    expect(res).toEqual([{ file: "CLAUDE.md", moved: 1 }, { file: "GEMINI.md", moved: 0 }]);
    expect(read("AGENTS.md")).toBe(`# Shared\n\n${block("playbook", "method")}\n\nOnly Claude knew this.\n`);
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(dir, "GEMINI.md"))).toBe(false);
  });

  it("creates AGENTS.md when only CLAUDE.md existed", () => {
    write("CLAUDE.md", "# Rules\n\nBe kind.\n");
    migrateLegacyAgentFiles({ projectDir: dir });
    expect(read("AGENTS.md")).toBe("# Rules\n\nBe kind.\n");
  });

  it("a dry run reports and touches nothing", () => {
    write("CLAUDE.md", "Be kind.\n");
    expect(migrateLegacyAgentFiles({ projectDir: dir, dryRun: true })).toEqual([{ file: "CLAUDE.md", moved: 1 }]);
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("in a Rulesync repo nothing moves: its rule source owns the agent files", () => {
    write("CLAUDE.md", "Be kind.\n");
    expect(migrateLegacyAgentFiles({ projectDir: dir, rulesync: true })).toEqual([]);
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
  });

  it("without legacy files it does nothing", () => {
    expect(migrateLegacyAgentFiles({ projectDir: dir })).toEqual([]);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });
});
