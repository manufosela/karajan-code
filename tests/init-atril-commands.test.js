// KJC-TSK-1219 (ADR 0021, step 15d): kj init installs Karajan's kj-* commands into atril's
// store under .karajan, on demand, instead of copying them into .claude/commands; with
// rulesync, atril sync takes the bridge and the router rule to every CLI.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installKarajanCommands } from "../src/commands/init-atril.js";
import { hasAtrilStore } from "../src/skills/atril-skills.js";

let project;
const lines = [];
const logger = { info: (m) => lines.push(m), warn: (m) => lines.push(`WARN ${m}`) };
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "kj-init-atril-"));
  lines.length = 0;
});
afterEach(() => rmSync(project, { recursive: true, force: true }));
const env = () => ({ ...process.env, ATRIL_USER_ROOT: join(project, "no-user-store") });

describe("kj init: Karajan's commands go to atril's store", () => {
  it("installs every kj-* command under .karajan/commands and nothing under .claude/commands", () => {
    const result = installKarajanCommands({ projectDir: project, logger, env: env() });
    const installed = readdirSync(join(project, ".karajan", "commands"));
    expect(installed).toHaveLength(14);
    expect(result.installed).toBe(14);
    expect(existsSync(join(project, ".claude", "commands"))).toBe(false);
    expect(lines.join("\n")).toMatch(/rulesync init/);
    expect(installKarajanCommands({ projectDir: project, logger, env: env() }).installed).toBe(0);
    expect(lines.join("\n")).toMatch(/0 Karajan command\(s\) installed .*\(14 already there\)/);
  });

  it("warns by name about a command atril refuses, and installs the rest", () => {
    mkdirSync(join(project, ".karajan", "commands"), { recursive: true });
    writeFileSync(join(project, ".karajan", "commands", "kj-run.md"), "---\nname: kj-run\ndescription: mine\nkind: command\n---\nmy own\n");
    expect(installKarajanCommands({ projectDir: project, logger, env: env() }).installed).toBe(13);
    expect(lines.join("\n")).toMatch(/WARN kj: kj-run\.md was not installed in \.karajan: .*different content/);
  });

  it("runs atril sync when the project uses rulesync", () => {
    mkdirSync(join(project, ".rulesync"));
    installKarajanCommands({ projectDir: project, logger, env: env() });
    expect(existsSync(join(project, ".rulesync", "commands", "atril.md"))).toBe(true);
    expect(existsSync(join(project, ".rulesync", "rules", "atril-router.md"))).toBe(true);
  });

  it("keeps the roles on their usual skills: only a skills/ folder sends them to atril", () => {
    installKarajanCommands({ projectDir: project, logger, env: env() });
    expect(hasAtrilStore(project)).toBe(false);
    mkdirSync(join(project, ".karajan", "skills"));
    expect(hasAtrilStore(project)).toBe(true);
  });
});
