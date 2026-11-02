// ADR 0021 decision 14: a plugin's path variables are filled in at resolve, never written into the store.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expose, persistentPieces, unexpose } from "../src/bridge.js";
import { readLock } from "../src/lock.js";
import { callTool } from "../src/mcp.js";
import { installPluginMarkdown } from "../src/plugin-markdown.js";
import { pluginDataDir, substitutePluginVars } from "../src/plugin-vars.js";
import { resolveBlock } from "../src/resolve.js";
import { status } from "../src/status.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));

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

describe("plugin variables at resolve", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-pvars-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (base, rel, content) => {
    mkdirSync(dirname(join(base, rel)), { recursive: true });
    writeFileSync(join(base, rel), content);
  };
  // A project whose plugin "kit" is cached in <store>/plugins/kit/1.0.0 and installed from there.
  const project = (name = "a") => {
    const base = join(dir, name);
    const opts = { root: join(base, "store"), projectDir: base, userRoot: join(base, "user") };
    const cache = join(opts.root, "plugins", "kit", "1.0.0");
    write(cache, ".claude-plugin/plugin.json", JSON.stringify({ name: "kit", version: "1.0.0" }));
    write(cache, "skills/tdd/SKILL.md", "---\ndescription: Test first\n---\n${CLAUDE_PLUGIN_ROOT}/a ${PLUGIN_DATA} ${CLAUDE_SKILL_DIR}/b\n");
    write(cache, "commands/ship.md", "---\ndescription: Ship\n---\n${CLAUDE_SKILL_DIR} ${user_config.k}\n");
    installPluginMarkdown(cache, opts);
    return { opts, cache, store: opts.root };
  };
  it("keeps the variables in the store, free of this machine's paths, with status ok", () => {
    const { opts, store } = project();
    expect(readFileSync(join(store, "skills/kit__tdd/SKILL.md"), "utf8")).toContain("${CLAUDE_PLUGIN_ROOT}/a ${PLUGIN_DATA}");
    expect(readFileSync(join(store, "atril.lock.json"), "utf8")).not.toContain(dir);
    expect(status(opts).map((s) => s.state)).toEqual(["ok", "ok"]);
  });
  it("stores the same bytes and hashes on two machines", () => {
    const [a, b] = [project("a"), project("b")];
    const bytes = ({ store }) => readFileSync(join(store, "skills/kit__tdd/SKILL.md"), "utf8");
    expect(bytes(a)).toBe(bytes(b));
    expect(readLock(a.opts).artifacts).toEqual(readLock(b.opts).artifacts);
  });
  it("fills a skill's cache, data and skill folders, creating the data folder", () => {
    const { opts, cache, store } = project();
    const out = resolveBlock("skill:kit__tdd", opts);
    const data = pluginDataDir(store, "kit");
    expect(out.block[0].content).toBe(`${cache}/a ${data} ${join(store, "skills/kit__tdd")}/b\n`);
    expect(out).not.toHaveProperty("unresolved");
    expect(existsSync(data)).toBe(true);
  });
  it("leaves the cache variable and reports it when the cache is missing, still filling the data folder", () => {
    const { opts, cache, store } = project();
    rmSync(cache, { recursive: true });
    const out = resolveBlock("skill:kit__tdd", opts);
    expect(out.block[0].content).toContain(`\${CLAUDE_PLUGIN_ROOT}/a ${pluginDataDir(store, "kit")} `);
    expect(out.unresolved).toEqual([{ ref: "skill:kit__tdd", variable: "CLAUDE_PLUGIN_ROOT", reason: "not cached", hint: expect.stringContaining(cache) }]);
  });
  it("reports skill-only and undeclared variables of a command and leaves the text as written", () => {
    const { opts } = project();
    const out = resolveBlock("command:kit__ship", opts);
    expect(out.block[0].content).toBe("${CLAUDE_SKILL_DIR} ${user_config.k}\n");
    expect(out.unresolved).toEqual([
      { ref: "command:kit__ship", variable: "CLAUDE_SKILL_DIR", reason: "skill-only" },
      { ref: "command:kit__ship", variable: "user_config.k", reason: "undeclared" },
    ]);
  });
  it("touches no local artifact and reports a plugin artifact with no lock entry", () => {
    const { opts, store } = project();
    write(store, "commands/loc.md", "---\nname: loc\nkind: command\ndescription: Local\n---\n${CLAUDE_PLUGIN_ROOT}\n");
    write(store, "commands/orphan.md", "---\nname: orphan\nkind: command\ndescription: Orphan\natril:\n  plugin: ghost\n---\n${CLAUDE_PLUGIN_ROOT}\n");
    const local = resolveBlock("command:loc", opts);
    expect(local.block[0].content).toBe("${CLAUDE_PLUGIN_ROOT}\n");
    expect(local).not.toHaveProperty("unresolved");
    expect(resolveBlock("command:orphan", opts).unresolved).toMatchObject([{ variable: "CLAUDE_PLUGIN_ROOT", reason: "no lock entry" }]);
  });
  it("reports a lock plugin with no version instead of throwing", () => {
    const { opts, store } = project();
    const lock = readLock(opts);
    delete lock.plugins.kit.version;
    writeFileSync(join(store, "atril.lock.json"), JSON.stringify(lock));
    expect(resolveBlock("skill:kit__tdd", opts).unresolved[0]).toMatchObject({ reason: "no usable version in the lock" });
  });
  it("records the effective version when the manifest has none", () => {
    const { opts } = project();
    const bare = (name) => {
      write(join(dir, name), ".claude-plugin/plugin.json", JSON.stringify({ name }));
      write(join(dir, name), "commands/x.md", "---\ndescription: X\n---\nx\n");
      return join(dir, name);
    };
    installPluginMarkdown(bare("pinned"), opts, { from: { commit: "a".repeat(40) } });
    installPluginMarkdown(bare("loose"), opts);
    expect(readLock(opts).plugins.pinned.version).toBe("aaaaaaaaaaaa");
    expect(readLock(opts).plugins.loose.version).toBe("local");
  });

  describe("on demand: route, MCP and sync", () => {
    const route = ({ opts }, ...args) => spawnSync(process.execPath, [BIN, "route", ...args, "--root", opts.root], {
      cwd: opts.projectDir, encoding: "utf8", env: { ...process.env, ATRIL_ROOT: "", ATRIL_USER_ROOT: opts.userRoot },
    });
    it("gives the filled content of an item with variables and paths only for the rest", () => {
      const p = project();
      write(p.store, "commands/loc.md", "---\nname: loc\nkind: command\ndescription: Local\nuses: [skill:kit__tdd]\n---\nplain\n");
      const [filled, plain] = JSON.parse(route(p, "loc", "--json").stdout).block;
      expect(filled.content).toBe(`${p.cache}/a ${pluginDataDir(p.store, "kit")} ${join(p.store, "skills/kit__tdd")}/b\n`);
      expect(plain).not.toHaveProperty("content");
    });
    it("carries the filled content of a delegated subagent too", () => {
      const p = project();
      write(p.cache, "agents/helper.md", "---\ndescription: Helper\n---\n${PLUGIN_DATA}\n");
      installPluginMarkdown(p.cache, p.opts);
      write(p.store, "commands/loc.md", "---\nname: loc\nkind: command\ndescription: Local\ndelegates: [agent:kit__helper]\n---\nplain\n");
      const [sub] = JSON.parse(route(p, "loc", "--json").stdout).block;
      expect(sub).toMatchObject({ as: "subagent", content: `${pluginDataDir(p.store, "kit")}\n` });
    });
    it("reports unresolved variables in the JSON and on stderr in text mode", () => {
      const p = project();
      const json = JSON.parse(route(p, "ship", "--json").stdout);
      expect(json.unresolved).toMatchObject([{ ref: "command:kit__ship", variable: "CLAUDE_SKILL_DIR", reason: "skill-only" }, { variable: "user_config.k" }]);
      expect(route(p, "ship").stderr).toContain("unresolved\tcommand:kit__ship\t${CLAUDE_SKILL_DIR}\tskill-only\n");
    });
    it("gives the same filled content through the MCP resolve tool", () => {
      const p = project();
      const { text } = callTool("resolve", { task: "test first" }, p.opts).content[0];
      expect(JSON.parse(text).block[0].content).toContain(p.cache);
    });
    it("tells the agent to use content when present", () => {
      expect(persistentPieces(project().opts)[0].content).toContain("`content` when");
    });
    it("refuses to expose a plugin artifact that uses variables, naming it, and exposes a plain one", () => {
      const { opts, store } = project();
      write(store, "commands/plain.md", "---\nname: plain\nkind: command\ndescription: Plain\natril:\n  plugin: kit\n---\nno variables\n");
      expose(["skill:kit__tdd"], opts);
      expect(() => persistentPieces(opts)).toThrow(/skill:kit__tdd.*on demand/);
      unexpose(["skill:kit__tdd"], opts);
      expose(["command:plain"], opts);
      expect(persistentPieces(opts).map((piece) => piece.path)).toContain("commands/plain.md");
    });
  });
});
