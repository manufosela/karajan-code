// ADR 0021, plan step 13 P3b: installPlugin composes find, fetch, inventory, confirm, npm and the Markdown install.
// Git and npm are fakes: no network.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeConfig } from "../src/config.js";
import { SAFE } from "../src/fetch.js";
import { readLock, recordPlugin } from "../src/lock.js";
import { installPlugin, installPluginSet, pluginInstallSet, updatePlugin } from "../src/plugin-install.js";
import { removePlugin } from "../src/plugin-remove.js";

// recordPlugin runs after the Markdown is written: failing it injects a failure there; `torn` also half-writes the lock.
const failRecord = vi.hoisted(() => ({ plugin: null, torn: null }));
vi.mock("../src/lock.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, recordPlugin: (name, ...rest) => {
    if (name !== failRecord.plugin) return real.recordPlugin(name, ...rest);
    if (failRecord.torn) writeFileSync(failRecord.torn, "{");
    throw new Error("lock write failed");
  } };
});

const C1 = "a".repeat(40);
let dir, calls, runs, tree, confirm, head;
beforeEach(() => {
  head = C1;
  dir = mkdtempSync(join(tmpdir(), "atril-plugin-install-"));
  calls = [];
  runs = 0;
  tree = {};
  confirm = vi.fn(() => true);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (base, rel, content) => {
  mkdirSync(dirname(join(base, rel)), { recursive: true });
  writeFileSync(join(base, rel), typeof content === "string" ? content : JSON.stringify(content));
};
const plant = (base, extra = {}) => {
  put(base, ".claude-plugin/plugin.json", { name: "kit", version: "1.0.0", ...extra.manifest });
  put(base, "skills/tdd/SKILL.md", "---\nname: tdd\ndescription: Test first\n---\nbody\n");
  put(base, "commands/ship.md", "---\ndescription: Ship\n---\nShip it\n");
  for (const [rel, content] of Object.entries(extra.files ?? {})) put(base, rel, content);
};
const git = (args, cwd) => {
  const [verb, ...rest] = args.slice(SAFE.length);
  calls.push(verb);
  if (verb === "fetch") { mkdirSync(join(cwd, ".git"), { recursive: true }); plant(cwd, tree); }
  return verb === "rev-parse" ? `${head}\n` : "";
};
const run = (_cmd, _args, cwd) => { runs++; mkdirSync(join(cwd, "node_modules")); };
const NPM = { "package.json": { name: "kit", dependencies: { a: "1.0.0" } }, "package-lock.json": { lockfileVersion: 3, packages: {} } };
const market = (source) => {
  put(dir, "mkt/.claude-plugin/marketplace.json", { name: "m", plugins: [{ name: "kit", source }] });
  writeConfig({ catalogs: ["mkt"] }, { projectDir: dir, root: "store", userRoot: join(dir, "nouser") });
};
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "nouser") });
const install = (opts = o()) => installPlugin("kit", opts, { confirm, git, run });
const lock = () => readLock(o());
const GH = { source: "github", repo: "o/r", sha: C1 };

describe("pluginInstallSet", () => {
  // Every plugin in `manifests` is offered by one marketplace and planted as a relative path.
  const offer = (manifests) => {
    for (const [name, extra] of Object.entries(manifests)) put(dir, `mkt/plugins/${name}/.claude-plugin/plugin.json`, { name, version: "1.0.0", ...extra });
    put(dir, "mkt/.claude-plugin/marketplace.json", { name: "m", plugins: Object.keys(manifests).map((name) => ({ name, source: `./plugins/${name}` })) });
    writeConfig({ catalogs: ["mkt"] }, o());
  };

  it("puts the dependencies first, in the order the plugin lists them, and the plugin last", () => {
    offer({ app: { dependencies: ["b", "a"] }, a: {}, b: { dependencies: ["a"] } });
    expect(pluginInstallSet("app", o())).toMatchObject({ order: ["a", "b", "app"], skipped: [] });
  });

  it("fails naming the plugin that needs a missing dependency and the catalogs searched", () => {
    offer({ app: { dependencies: ["ghost"] } });
    expect(() => pluginInstallSet("app", o())).toThrow(/app.*ghost.*not found in the catalogs: .*mkt/);
  });

  it("fails naming a cycle", () => {
    offer({ a: { dependencies: ["b"] }, b: { dependencies: ["a"] } });
    expect(() => pluginInstallSet("a", o())).toThrow("a -> b -> a");
  });

  it("leaves an installed dependency out, but keeps the plugin itself", async () => {
    offer({ app: { dependencies: ["a", "b"] }, a: {}, b: {} });
    recordPlugin("a", { catalog: "mkt", version: "1.0.0", entries: [] }, o());
    expect(pluginInstallSet("app", o())).toMatchObject({ order: ["b", "app"], skipped: ["a"] });
    recordPlugin("app", { catalog: "mkt", version: "1.0.0", entries: [] }, o());
    expect(pluginInstallSet("app", o())).toMatchObject({ order: ["b", "app"], skipped: ["a"] });
  });
});

describe("installPlugin", () => {
  it("installs a Markdown-only plugin and records it", async () => {
    market(GH);
    const result = await install();
    expect(result).toMatchObject({ plugin: "kit", version: "1.0.0", commit: C1, catalog: "mkt", status: "installed", fetched: "fetched", notInstalled: { hooks: [], mcpServers: [], bin: [] } });
    expect(lock().plugins.kit).toEqual({ catalog: "mkt", source: "o/r", commit: C1, version: "1.0.0", entries: ["command:kit__ship", "skill:kit__tdd"] });
    expect(Object.values(lock().artifacts).every((a) => a.origin === "plugin")).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toMatchObject({ name: "kit" });
    expect(confirm.mock.calls[0][1]).toMatchObject({ commit: C1, status: "fetched" });
  });

  it.each([() => false, async () => false])("declines without writing the store or the lock, and keeps the cache", async (answer) => {
    market(GH);
    tree = { files: NPM };
    confirm = vi.fn(answer);
    expect((await install()).status).toBe("declined");
    expect(existsSync(join(dir, "store", "skills"))).toBe(false);
    expect(existsSync(join(dir, "store", "commands"))).toBe(false);
    expect(lock().plugins).toBeUndefined();
    expect(runs).toBe(0);
    expect(existsSync(join(dir, "store", "plugins", "kit", "1.0.0"))).toBe(true);
  });

  it("rolls the store and lock back on a failure and keeps the cache", async () => {
    market(GH);
    tree = { files: NPM };
    put(dir, "store/commands/kit__ship.md", "---\ndescription: Mine\n---\nlocal\n");
    await expect(install()).rejects.toThrow("already exists");
    expect(existsSync(join(dir, "store", "skills", "kit__tdd"))).toBe(false);
    expect(Object.keys(lock().artifacts ?? {})).not.toContain("skill:kit__tdd");
    expect(lock().plugins?.kit).toBeUndefined();
    expect(readFileSync(join(dir, "store", "commands", "kit__ship.md"), "utf8")).toContain("local");
    expect(existsSync(join(dir, "store", "plugins", "kit", "1.0.0", "node_modules"))).toBe(true);
  });

  it("reports hooks (file and inline) and MCP servers as not installed", async () => {
    market(GH);
    const hook = { type: "command", command: "x" };
    tree = { manifest: { hooks: { Stop: [{ matcher: "", hooks: [hook] }] } }, files: { "hooks/hooks.json": { hooks: { Start: [{ matcher: "", hooks: [hook] }] } }, ".mcp.json": { mcpServers: { db: { command: "npx" } } } } };
    const result = await installPlugin("kit", o(), { confirm, git, run, rulesync: () => { throw new Error("absent"); } });
    expect(result.entries.length).toBe(2);
    expect(result.notInstalled.hooks).toHaveLength(2);
    expect(result.notInstalled.mcpServers[0].name).toBe("db");
    // ADR 0042: the derived plugin is written and listed, and nothing is run (no npm lockfile here, so runs counts any spawn).
    expect(result.derived).toMatchObject({ name: "kit", commands: [{ cli: "claude" }, { cli: "agy" }] });
    expect(existsSync(join(dir, "store", "plugins", ".marketplace", ".claude-plugin", "marketplace.json"))).toBe(true);
    expect(runs).toBe(0);
  });

  describe("hooks and MCP through rulesync", () => {
    const withMcp = () => { market(GH); tree = { files: { ".mcp.json": { mcpServers: { db: { command: "npx" } } } } }; };
    // The import: canonical .rulesync/mcp.json under --output-root, never in the project.
    const imports = (args) => {
      const root = args[args.indexOf("--output-root") + 1];
      put(root, ".rulesync/mcp.json", { mcpServers: { db: { command: "npx" } } });
    };

    it("merges the imported entries into the project's .rulesync and reports them", async () => {
      withMcp();
      mkdirSync(join(dir, ".rulesync"));
      const rulesync = vi.fn((_cmd, args) => { if (args.includes("import")) imports(args); });
      const result = await installPlugin("kit", o(), { confirm, git, run, rulesync });
      expect(JSON.parse(readFileSync(join(dir, ".rulesync", "mcp.json"), "utf8")).mcpServers.db).toEqual({ command: "npx" });
      expect(result.rulesync).toEqual({ status: "merged" });
      expect(result.notInstalled.mcpServers).toEqual([]);
    });

    it("points a script of the plugin to its copy in the store and reports the rewrite", async () => {
      withMcp();
      mkdirSync(join(dir, ".rulesync"));
      const rulesync = (_cmd, args) => { if (args.includes("import")) put(args[args.indexOf("--output-root") + 1], ".rulesync/mcp.json", { mcpServers: { db: { command: "./servers/x" } } }); };
      const result = await installPlugin("kit", o(), { confirm, git, run, rulesync });
      expect(JSON.parse(readFileSync(join(dir, ".rulesync", "mcp.json"), "utf8")).mcpServers.db.command).toBe("./store/plugins/kit/1.0.0/servers/x");
      expect(result.rulesync).toEqual({ status: "merged", rewritten: true });
    });

    it("installs the Markdown, writes no entry and says what was left out when rulesync is absent", async () => {
      withMcp();
      const result = await installPlugin("kit", o(), { confirm, git, run, rulesync: () => { throw new Error("absent"); } });
      expect(result.entries.length).toBe(2);
      expect(existsSync(join(dir, ".rulesync"))).toBe(false);
      expect(result.rulesync).toEqual({ status: "absent" });
      expect(result.notInstalled.mcpServers).toHaveLength(1);
    });

    it("never runs rulesync for a plugin without hooks or MCP servers", async () => {
      market(GH);
      const rulesync = vi.fn();
      const result = await installPlugin("kit", o(), { confirm, git, run, rulesync });
      expect(rulesync).not.toHaveBeenCalled();
      expect(result.rulesync).toBeUndefined();
    });

    it("an update with no hooks or MCP servers drops the entries the old version wrote", async () => {
      withMcp();
      mkdirSync(join(dir, ".rulesync"));
      await installPlugin("kit", o(), { confirm, git, run, rulesync: (_cmd, args) => { if (args.includes("import")) imports(args); } });
      head = "b".repeat(40);
      tree = { manifest: { version: "2.0.0" } };
      market({ ...GH, sha: head }); // the catalog now pins a version without the MCP server
      await updatePlugin("kit", o(), { confirm, git, run });
      expect(JSON.parse(readFileSync(join(dir, ".rulesync", "mcp.json"), "utf8")).mcpServers).toEqual({});
    });

    it("installs nothing when the import fails", async () => {
      withMcp();
      const rulesync = (_cmd, args) => { if (args.includes("import")) throw new Error("boom"); };
      await expect(installPlugin("kit", o(), { confirm, git, run, rulesync })).rejects.toThrow("rulesync import failed");
      expect(lock().plugins).toBeUndefined();
      expect(existsSync(join(dir, ".rulesync"))).toBe(false);
    });
  });

  it("a Markdown-only plugin has no derived entry and no marketplace", async () => {
    market(GH);
    expect((await install()).derived).toBeUndefined();
    expect(existsSync(join(dir, "store", "plugins", ".marketplace"))).toBe(false);
  });

  it("a reinstall reuses the cache and its node_modules, asks again, and leaves the lock byte-identical", async () => {
    market(GH);
    tree = { files: NPM };
    await install();
    const before = readFileSync(join(dir, "store", "atril.lock.json"), "utf8");
    calls.length = 0;
    const again = await install();
    expect(again).toMatchObject({ fetched: "cached", npm: { status: "present" } });
    expect(again.entries.map((e) => e.status)).toEqual(["unchanged", "unchanged"]);
    expect([runs, calls.includes("fetch"), confirm.mock.calls.length]).toEqual([1, false, 2]);
    expect(readFileSync(join(dir, "store", "atril.lock.json"), "utf8")).toBe(before);
  });

  it("never writes a path source or the tmp dir into the lock", async () => {
    plant(join(dir, "mkt", "plugins", "kit"));
    market("./plugins/kit");
    await install();
    expect(lock().plugins.kit).not.toHaveProperty("source");
    expect(lock().plugins.kit).not.toHaveProperty("commit");
    expect(JSON.stringify(lock())).not.toContain(dir);
  });

  it("throws before any git call without a confirm function", async () => {
    market(GH);
    await expect(installPlugin("kit", o(), { git })).rejects.toThrow("confirm");
    expect(calls).toEqual([]);
  });

  it("installs the Markdown and reports npm unsupported when there is no lockfile", async () => {
    market(GH);
    tree = { files: { "package.json": { name: "kit", dependencies: { a: "1" } } } };
    const result = await install();
    expect(result.status).toBe("installed");
    expect(result.npm.status).toBe("unsupported");
    expect(result.npm.reason).toBeTruthy();
    expect(runs).toBe(0);
  });
});

describe("installPluginSet", () => {
  const offer = (manifests) => {
    for (const [name, extra] of Object.entries(manifests)) {
      put(dir, `mkt/plugins/${name}/.claude-plugin/plugin.json`, { name, version: "1.0.0", ...extra });
      put(dir, `mkt/plugins/${name}/skills/${name}-s/SKILL.md`, `---\nname: ${name}-s\ndescription: d\n---\nbody\n`);
    }
    put(dir, "mkt/.claude-plugin/marketplace.json", { name: "m", plugins: Object.keys(manifests).map((name) => ({ name, source: `./plugins/${name}` })) });
    writeConfig({ catalogs: ["mkt"] }, o());
  };
  const installSet = () => installPluginSet("app", o(), { confirm, git, run });
  const app = { app: { dependencies: ["a", "b"] }, a: {}, b: {} };

  it("installs the dependencies in order, then the plugin, and reports the set", async () => {
    offer(app);
    const result = await installSet();
    expect(result).toMatchObject({ plugin: "app", status: "installed", skipped: [] });
    expect(result.dependencies.map((d) => d.plugin)).toEqual(["a", "b"]);
    expect(Object.keys(lock().plugins).toSorted()).toEqual(["a", "app", "b"]);
    expect(lock().plugins.app.dependencies).toEqual(["a", "b"]);
    expect(lock().plugins.a.dependencies).toBeUndefined();
  });

  it("shows what this run downloaded as fetched, not cached", async () => {
    offer(app);
    await installSet();
    expect(confirm.mock.calls[0][0].map((m) => m.status)).toEqual(["fetched", "fetched", "fetched"]);
  });

  it("applies the pin override to the plugin asked for only, not to its dependencies", async () => {
    // a is on GitHub at C1: the pin C2 would disagree if it reached a (app is a local path)
    const C2 = "b".repeat(40);
    put(dir, "mkt/plugins/app/.claude-plugin/plugin.json", { name: "app", version: "1.0.0", dependencies: ["a"] });
    put(dir, "mkt/plugins/app/commands/go.md", "---\ndescription: Go\n---\nGo\n");
    put(dir, "mkt/.claude-plugin/marketplace.json", { name: "m", plugins: [{ name: "app", source: "./plugins/app" }, { name: "a", source: { source: "github", repo: "o/a", sha: C1 } }] });
    writeConfig({ catalogs: ["mkt"] }, o());
    tree = { manifest: { name: "a" } };
    const result = await installPluginSet("app", { ...o(), commit: C2 }, { confirm, git, run });
    expect(result.dependencies.map((d) => d.plugin)).toEqual(["a"]);
  });

  it("leaves an installed dependency out and reports it as skipped", async () => {
    offer(app);
    recordPlugin("a", { catalog: "mkt", version: "1.0.0", entries: [] }, o());
    const result = await installSet();
    expect(result.skipped).toEqual(["a"]);
    expect(result.dependencies.map((d) => d.plugin)).toEqual(["b"]);
  });

  it("asks once for the whole set, and a decline writes nothing", async () => {
    offer(app);
    confirm = vi.fn(() => false);
    const result = await installSet();
    expect(result.status).toBe("declined");
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0].map((m) => m.name)).toEqual(["a", "b", "app"]);
    expect(lock().plugins).toBeUndefined();
    expect(existsSync(join(dir, "store", "skills"))).toBe(false);
  });

  it("rolls back what this run installed and leaves a reinstalled member untouched", async () => {
    offer(app);
    await installSet();
    removePlugin("a", { ...o(), force: true });
    removePlugin("b", { ...o(), force: true }); // a and b are new again; app is a reinstall
    const appEntry = structuredClone(lock().plugins.app);
    put(dir, "mkt/plugins/app/commands/go.md", "---\ndescription: Go\n---\ngo\n"); // new file in the source...
    put(dir, "store/commands/app__go.md", "---\ndescription: Mine\n---\nlocal\n"); // ...that a local file already holds
    await expect(installSet()).rejects.toThrow(/app.*already exists.*rolled back: b, a/s);
    expect(lock().plugins.a).toBeUndefined();
    expect(lock().plugins.b).toBeUndefined();
    expect(lock().plugins.app).toEqual(appEntry);
    expect(existsSync(join(dir, "store", "skills", "app__app-s"))).toBe(true);
  });

  it("keeps an untracked artifact that already existed when a later member fails", async () => {
    offer(app);
    const mine = "---\ndescription: Mine\n---\nlocal\n";
    put(dir, "store/skills/a__a-s/SKILL.md", mine); // a's artifact, held by nobody
    put(dir, "mkt/plugins/app/commands/go.md", "---\ndescription: Go\n---\ngo\n");
    put(dir, "store/commands/app__go.md", mine);
    await expect(installSet()).rejects.toThrow(/rolled back/);
    for (const file of ["skills/a__a-s/SKILL.md", "commands/app__go.md"]) expect(readFileSync(join(dir, "store", file), "utf8")).toBe(mine);
    expect(lock().plugins).toBeUndefined();
  });

  it.each([["app", false], ["b", false], ["app", true], ["b", true]])("restores the store and the lock when %s fails after its Markdown is written (torn lock: %s)", async (failing, torn) => {
    offer(app);
    await installSet();
    removePlugin("a", { ...o(), force: true });
    removePlugin("b", { ...o(), force: true }); // a and b are new again; app is a reinstall
    put(dir, "mkt/plugins/app/commands/go.md", "---\ndescription: Go\n---\ngo\n"); // the reinstall also brings a new file
    // Not compared: the fetch cache (store/plugins, kept on purpose) and emptied folders.
    const files = () => readdirSync(join(dir, "store"), { recursive: true }).filter((p) => !p.startsWith("plugins") && statSync(join(dir, "store", p)).isFile()).toSorted();
    const snapshot = () => [readFileSync(join(dir, "store", "atril.lock.json"), "utf8"), files()];
    const before = snapshot();
    failRecord.plugin = failing;
    failRecord.torn = torn ? join(dir, "store", "atril.lock.json") : null;
    try {
      await expect(installSet()).rejects.toThrow(new RegExp(`^${failing}: lock write failed`));
    } finally {
      failRecord.plugin = failRecord.torn = null;
    }
    expect(snapshot()).toEqual(before);
  });

  describe("each dependency honours its own pluginMode", () => {
    const choose = (pluginMode) => writeConfig({ catalogs: ["mkt"], pluginMode }, o());
    it("leaves a skip dependency out, reports it, and installs the rest", async () => {
      offer(app);
      choose({ a: "skip" });
      const result = await installSet();
      expect(result.dependencies.map((d) => [d.plugin, d.mode])).toEqual([["b", "split"]]);
      expect(result.skipped).toEqual(["a"]);
      expect(result.chosen).toEqual([{ plugin: "a", mode: "skip" }]);
      expect(Object.keys(lock().plugins).toSorted()).toEqual(["app", "b"]);
      expect(confirm.mock.calls[0][0].map((m) => [m.name, m.mode])).toEqual([["b", "split"], ["app", "split"]]);
    });
    it("does not install a native dependency and carries its instruction", async () => {
      offer(app);
      choose({ b: "native" });
      const result = await installSet();
      expect(result.skipped).toEqual(["b"]);
      expect(result.chosen).toMatchObject([{ plugin: "b", mode: "native" }]);
      expect(result.chosen[0].instructions.join("\n")).toMatch(/claude: install "b".*does not know the exact command/s);
      expect(lock().plugins.b).toBeUndefined();
    });
    it("does not follow what a skipped dependency needs", async () => {
      offer({ app: { dependencies: ["a"] }, a: { dependencies: ["ghost"] } });
      choose({ a: "skip" });
      expect(await installSet()).toMatchObject({ skipped: ["a"], dependencies: [] });
    });
    it("installs only the plugin asked for when every dependency is skipped", async () => {
      offer(app);
      choose({ a: "skip", b: "skip" });
      const result = await installSet();
      expect(result).toMatchObject({ status: "installed", dependencies: [], skipped: ["a", "b"] });
      expect(Object.keys(lock().plugins)).toEqual(["app"]);
    });
    it("still rolls back what this run installed when a split member fails and another was skipped", async () => {
      offer(app);
      choose({ a: "skip" });
      put(dir, "mkt/plugins/app/commands/go.md", "---\ndescription: Go\n---\ngo\n");
      put(dir, "store/commands/app__go.md", "---\ndescription: Mine\n---\nlocal\n");
      await expect(installSet()).rejects.toThrow(/app.*already exists.*rolled back: b/s);
      expect(lock().plugins).toBeUndefined();
    });
    it("fails the whole set before writing when a split dependency has no Markdown", async () => {
      offer(app);
      rmSync(join(dir, "mkt/plugins/a/skills"), { recursive: true });
      await expect(installSet()).rejects.toThrow(/a has no Markdown to split.*native or skip/);
      expect(lock().plugins).toBeUndefined();
      choose({ a: "skip" });
      expect(await installSet()).toMatchObject({ status: "installed", skipped: ["a"] });
    });
    it("keeps a requested plugin set to skip as it was", async () => {
      offer(app);
      choose({ app: "skip" });
      expect(await installSet()).toMatchObject({ status: "skipped", dependencies: [] });
    });
  });
});

describe("the choice per plugin (P12)", () => {
  const choose = (mode) => writeConfig({ catalogs: ["mkt"], pluginMode: { kit: mode } }, o());
  const set = () => installPluginSet("kit", o(), { confirm, git, run });

  it("rejects an unknown choice loudly", () => {
    expect(() => writeConfig({ pluginMode: { kit: "fast" } }, o())).toThrow(/pluginMode\.kit.*skip, split or native/);
    expect(() => writeConfig({ pluginMode: { "Bad Name": "skip" } }, o())).toThrow(/pluginMode\.Bad Name/);
  });

  it("split is the default and the result says so", async () => {
    market(GH);
    expect(await set()).toMatchObject({ status: "installed", mode: "split" });
  });

  it("skip records and writes nothing, and does not even ask", async () => {
    market(GH);
    choose("skip");
    expect(await set()).toMatchObject({ plugin: "kit", status: "skipped", mode: "skip", dependencies: [], skipped: [] });
    expect(confirm).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(lock().plugins).toBeUndefined();
    expect(existsSync(join(dir, "store", "skills"))).toBe(false);
  });

  it("native installs nothing and names, per CLI, what the user runs and that it fills the context", async () => {
    market(GH);
    choose("native");
    const result = await set();
    expect(result).toMatchObject({ status: "native", mode: "native" });
    expect(result.instructions.join("\n")).toMatch(/claude.*o\/r[\s\S]*agy.*o\/r[\s\S]*everything in context.*that CLI only/);
    expect(result.instructions.join("\n")).toMatch(/does not know the exact command/);
    expect(calls).toEqual([]);
    expect(runs).toBe(0);
    expect(lock().plugins).toBeUndefined();
  });

  it("split says a plugin with no Markdown needs native or skip", async () => {
    put(dir, "mkt/plugins/kit/.claude-plugin/plugin.json", { name: "kit", version: "1.0.0" });
    market("./plugins/kit");
    await expect(set()).rejects.toThrow(/kit has no Markdown to split.*native or skip/);
    choose("skip");
    expect(await set()).toMatchObject({ status: "skipped" });
  });

  it("a plugin installed as split and then set to native is left as it is, and install says how to remove it", async () => {
    market(GH);
    await set();
    choose("native");
    expect(await set()).toMatchObject({ status: "native", removeWith: "atril remove plugin:kit" });
    expect(lock().plugins.kit).toBeDefined();
    expect(await updatePlugin("kit", o(), { confirm, git, run })).toEqual({ plugin: "kit", status: "kept", mode: "native" });
  });

  it("remove of a skip or native plugin says there is nothing to remove", async () => {
    market(GH);
    choose("skip");
    expect(removePlugin("kit", o())).toEqual({ plugin: "kit", removed: [], purged: false, mode: "skip" });
    expect(() => removePlugin("ghost", o())).toThrow(/not installed/);
  });
});

describe("updatePlugin", () => {
  const C2 = "b".repeat(40);
  const HOOK = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "x.sh" }] }] } };
  const lockFile = () => readFileSync(join(dir, "store", "atril.lock.json"), "utf8");
  const skill = () => readFileSync(join(dir, "store", "skills", "kit__tdd", "SKILL.md"), "utf8");
  // The catalog pins C2 now, as `atril catalog update` would have; the plugin at C2 is 2.0.0 with a new command.
  const moveTo = (files = {}) => {
    head = C2;
    tree = { manifest: { version: "2.0.0" }, files: { "commands/new.md": "---\ndescription: New\n---\nnew\n", "skills/tdd/SKILL.md": "---\nname: tdd\ndescription: Test first\n---\nnew body\n", ...files } };
    market({ ...GH, sha: C2 });
  };
  const update = () => updatePlugin("kit", o(), { confirm, git, run });
  beforeEach(async () => {
    market(GH);
    await install();
    confirm.mockClear();
  });

  it("brings the store and the lock to the new commit, asking once when the inventory is the same", async () => {
    moveTo();
    expect(await update()).toMatchObject({ plugin: "kit", status: "updated", from: C1, commit: C2, version: "2.0.0" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][1]).toMatchObject({ commit: C2, from: C1, changed: false });
    expect(lock().plugins.kit).toEqual({ catalog: "mkt", source: "o/r", commit: C2, version: "2.0.0", entries: ["command:kit__new", "command:kit__ship", "skill:kit__tdd"] });
    expect(skill()).toContain("new body");
  });

  it("asks again when the inventory changed, and a refusal writes nothing", async () => {
    moveTo({ "hooks/hooks.json": HOOK });
    const before = [lockFile(), skill()];
    confirm = vi.fn((_, { again }) => !again);
    expect((await update()).status).toBe("declined");
    expect(confirm.mock.calls.map(([, info]) => [info.changed, Boolean(info.again)])).toEqual([[true, false], [true, true]]);
    expect([lockFile(), skill()]).toEqual(before);
  });

  it("always asks twice for a local plugin, which keeps no baseline: a declined attempt and its retry alike", async () => {
    put(dir, "mkt/plugins/kit/.claude-plugin/plugin.json", { name: "kit", version: "1.0.0" });
    put(dir, "mkt/plugins/kit/commands/ship.md", "---\ndescription: Ship\n---\nShip it\n");
    put(dir, "mkt/.claude-plugin/marketplace.json", { name: "m", plugins: [{ name: "kit", source: "./plugins/kit" }] });
    removePlugin("kit", { ...o(), purge: true });
    await install();
    confirm.mockClear();
    put(dir, "mkt/plugins/kit/hooks/hooks.json", HOOK);
    confirm = vi.fn((_, { again }) => !again);
    expect((await update()).status).toBe("declined");
    expect((await update()).status).toBe("declined"); // the retry is not fooled by the cache the first attempt replaced
    expect(confirm.mock.calls.map(([, info]) => [info.changed, Boolean(info.again)])).toEqual([[true, false], [true, true], [true, false], [true, true]]);
  });

  it("leaves a plugin already at the pinned commit alone and asks nothing", async () => {
    expect(await update()).toMatchObject({ plugin: "kit", status: "current", commit: C1 });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("restores the exact previous store and lock when the update fails", async () => {
    moveTo();
    const before = [lockFile(), skill()];
    failRecord.plugin = "kit";
    try {
      await expect(update()).rejects.toThrow(/lock write failed.*rolled back/);
    } finally {
      failRecord.plugin = null;
    }
    expect([lockFile(), skill()]).toEqual(before);
    expect(existsSync(join(dir, "store", "commands", "kit__new.md"))).toBe(false);
  });

  it("refuses a plugin that is not installed", async () => {
    await expect(updatePlugin("ghost", o(), { confirm, git, run })).rejects.toThrow('plugin "ghost" is not installed');
  });
});
