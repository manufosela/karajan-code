// ADR 0021, plan step 13c3 (i): a plugin's path variables are filled in at install, in c2's staging.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArtifact } from "../src/model.js";
import { installPluginMarkdown } from "../src/plugin-markdown.js";
import { pluginDataDir, pluginVarRewriter, substitutePluginVars } from "../src/plugin-vars.js";
import { scanStore } from "../src/scan.js";

describe("substitutePluginVars", () => {
  const values = { CLAUDE_PLUGIN_ROOT: "/r", PLUGIN_ROOT: "/r", CLAUDE_PLUGIN_DATA: "/d", PLUGIN_DATA: "/d", CLAUDE_SKILL_DIR: "/r/skills/s" };
  it("replaces each of the five path variables", () => {
    const text = "${CLAUDE_PLUGIN_ROOT} ${PLUGIN_ROOT} ${CLAUDE_PLUGIN_DATA} ${PLUGIN_DATA} ${CLAUDE_SKILL_DIR}";
    expect(substitutePluginVars(text, values)).toEqual({ text: "/r /r /d /d /r/skills/s", unresolved: [] });
  });
  it("inserts a value literally, even with $& or $1 in it", () => {
    expect(substitutePluginVars("${CLAUDE_PLUGIN_ROOT}/x", { CLAUDE_PLUGIN_ROOT: "/a$&b$1" }).text).toBe("/a$&b$1/x");
  });
  it("leaves runtime variables, the brace-less form and shell variables byte for byte, unreported", () => {
    const text = "$ARGUMENTS $1 ${CLAUDE_SESSION_ID} ${CLAUDE_PROJECT_DIR} $CLAUDE_PLUGIN_ROOT ${HOME}\r\n";
    expect(substitutePluginVars(text, values)).toEqual({ text, unresolved: [] });
  });
  it("leaves a variable with no value, and ${user_config.KEY}, as written and reports them", () => {
    const text = "${CLAUDE_SKILL_DIR}/x ${user_config.rootDir}";
    expect(substitutePluginVars(text, { CLAUDE_PLUGIN_ROOT: "/r" })).toEqual({
      text,
      unresolved: [{ variable: "CLAUDE_SKILL_DIR", reason: "no value" }, { variable: "user_config.rootDir", reason: "undeclared" }],
    });
  });
});

describe("pluginDataDir", () => {
  it("sits outside the version folders and refuses unsafe names", () => {
    expect(pluginDataDir("/s", "kit")).toBe(join("/s", "plugins", ".data", "kit"));
    expect(() => pluginDataDir("/s", "../x")).toThrow(/name/);
    expect(() => pluginDataDir("/s", ".x")).toThrow(/name/);
  });
});

describe("pluginVarRewriter", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-pvars-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (rel, content) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  const opts = () => ({ root: join(dir, "store"), projectDir: dir });
  const install = () => {
    const vars = pluginVarRewriter(join(dir, "p"), opts());
    return { vars, result: installPluginMarkdown(join(dir, "p"), opts(), { rewrite: vars.rewrite }) };
  };
  const seed = () => {
    write("p/.claude-plugin/plugin.json", JSON.stringify({ name: "kit" }));
    write("p/skills/tdd/SKILL.md", "---\ndescription: Test first\nallowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/a:*)\n---\nrun ${CLAUDE_SKILL_DIR}/x and ${CLAUDE_PLUGIN_ROOT}/y\n");
    write("p/skills/tdd/references/doc.md", "see ${CLAUDE_PLUGIN_ROOT}\n");
    write("p/skills/two/SKILL.md", "---\ndescription: Two\nallowed-tools:\n  - Bash(${CLAUDE_SKILL_DIR}/b:*)\n  - Read\n---\nbody\n");
    write("p/commands/ship.md", "---\ndescription: Ship\n---\n${CLAUDE_SKILL_DIR} ${CLAUDE_PLUGIN_DATA} ${user_config.k}\n");
  };
  it("fills the stored copy with absolute realpaths and leaves other files alone", () => {
    seed();
    const { vars, result } = install();
    const root = realpathSync(join(dir, "p"));
    const skill = readFileSync(join(dir, "store/skills/kit__tdd/SKILL.md"), "utf8");
    expect(skill).toContain(`run ${root}/skills/tdd/x and ${root}/y\n`);
    expect(skill).toContain(`allowed-tools: Bash(${root}/a:*)`);
    expect(parseArtifact(join(dir, "store/skills/kit__two/SKILL.md")).body).toBe("body\n");
    expect(readFileSync(join(dir, "store/skills/kit__two/SKILL.md"), "utf8")).toContain(`- Bash(${root}/skills/two/b:*)`);
    expect(readFileSync(join(dir, "store/skills/kit__tdd/references/doc.md"), "utf8")).toBe("see ${CLAUDE_PLUGIN_ROOT}\n");
    expect(existsSync(pluginDataDir(realpathSync(join(dir, "store")), "kit"))).toBe(true);
    expect(vars.unresolved).toEqual([
      { ref: "kit:ship", variable: "CLAUDE_SKILL_DIR", reason: "skill-only" },
      { ref: "kit:ship", variable: "user_config.k", reason: "undeclared" },
    ]);
    expect(scanStore(join(dir, "store"))).toHaveLength(3);
    expect(result.entries.every((e) => e.status === "installed")).toBe(true);
    expect(install().result.entries.every((e) => e.status === "unchanged")).toBe(true);
  });
  it("creates the data folder only when an entry names it and passes a non-string tool through", () => {
    write("p/.claude-plugin/plugin.json", JSON.stringify({ name: "kit" }));
    const out = pluginVarRewriter(join(dir, "p"), opts()).rewrite({ entry: { kind: "command", ref: "kit:a" }, front: { "allowed-tools": ["Read", 5] }, body: "x" });
    expect(out).toEqual({ front: { "allowed-tools": ["Read", 5] }, body: "x" });
    expect(existsSync(pluginDataDir(join(dir, "store"), "kit"))).toBe(false);
  });
});
