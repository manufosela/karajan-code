// ADR 0021, plan step 13c2: a plugin's Markdown half enters the store as
// <plugin>__<name>, all or nothing.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLock, writeLock } from "../src/lock.js";
import { parseArtifact } from "../src/model.js";
import { installPluginMarkdown } from "../src/plugin-markdown.js";
import { scanStore } from "../src/scan.js";
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-pmd-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const write = (rel, content = "") => {
  const file = join(dir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};
const at = (rel) => join(dir, rel);
const opts = () => ({ root: at("store"), projectDir: dir });
const seed = (extra = {}) => {
  write("p/.claude-plugin/plugin.json", JSON.stringify({ name: "kit", ...extra }));
  write("p/skills/tdd/SKILL.md", "---\nname: tdd\ndescription: Test first\n---\nbody\n");
  write("p/skills/tdd/scripts/run.sh", "echo hi\n");
  write("p/commands/ship.md", "---\ndescription: Ship\n---\nShip it\n");
  write("p/agents/rev.md", "---\ndescription: Reviews\n---\nReview it\n");
};
const run = () => installPluginMarkdown(at("p"), opts());
describe("installPluginMarkdown", () => {
  it("installs skills, commands and agents under <plugin>__<name>, marked and scannable", () => {
    seed();
    const result = run();
    expect(result.plugin).toBe("kit");
    expect(result.entries.map((e) => [e.kind, e.name, e.ref, e.status])).toEqual([
      ["skill", "kit__tdd", "kit:tdd", "installed"],
      ["command", "kit__ship", "kit:ship", "installed"],
      ["agent", "kit__rev", "kit:rev", "installed"],
    ]);
    const found = scanStore(at("store"));
    expect(found.map((a) => a.name).toSorted()).toEqual(["kit__rev", "kit__ship", "kit__tdd"]);
    expect(found.every((a) => a.atril.plugin === "kit")).toBe(true);
    expect(readFileSync(at("store/skills/kit__tdd/scripts/run.sh"), "utf8")).toBe("echo hi\n");
    expect(parseArtifact(at("store/commands/kit__ship.md")).body).toBe("Ship it\n");
  });
  it("records each artifact with origin plugin and the plugin in a plugins section", () => {
    seed({ version: "1.2.0" });
    const commit = "b".repeat(40);
    installPluginMarkdown(at("p"), opts(), { from: { catalog: "kits", source: "github:o/r", commit } });
    const lock = readLock(opts());
    expect(Object.values(lock.artifacts).map(({ origin, plugin }) => [origin, plugin])).toEqual(Array(3).fill(["plugin", "kit"]));
    expect(lock.plugins.kit).toEqual({ catalog: "kits", source: "github:o/r", commit, version: "1.2.0", entries: ["agent:kit__rev", "command:kit__ship", "skill:kit__tdd"] });
  });
  it("fails, rolling back, when an identical artifact is already held under another origin", () => {
    seed();
    run();
    const lock = readLock(opts());
    lock.artifacts["command:kit__ship"] = { origin: "local", hash: lock.artifacts["command:kit__ship"].hash };
    delete lock.plugins;
    writeLock(lock, opts());
    expect(() => run()).toThrow(/command:kit__ship.*origin local/);
    expect(readLock(opts())).not.toHaveProperty("plugins");
  });
  it("leaves no plugins entry when the install is rolled back", () => {
    seed();
    write("store/agents/kit__rev.md", "---\nname: kit__rev\ndescription: Other\nkind: agent\n---\nmine\n");
    expect(() => run()).toThrow(/different content/);
    expect(readLock(opts())).toEqual({ version: 1, artifacts: {} });
  });
  it("refuses a command with no frontmatter, since it has no description", () => {
    seed();
    write("p/commands/ship.md", "Ship it\n");
    expect(() => run()).toThrow(/ship\.md.*description/);
    expect(existsSync(at("store"))).toBe(false);
  });
  it("reports a re-run as unchanged", () => {
    seed();
    run();
    expect(run().entries.every((e) => e.status === "unchanged")).toBe(true);
  });
  it("rolls back what this call installed when an entry differs, and keeps what was already there", () => {
    seed();
    run();
    rmSync(at("store/commands/kit__ship.md"));
    write("p/agents/rev.md", "---\ndescription: Reviews\n---\nchanged\n");
    expect(() => run()).toThrow(/agent:kit__rev.*different content/);
    expect(existsSync(at("store/skills/kit__tdd"))).toBe(true);
    expect(existsSync(at("store/commands/kit__ship.md"))).toBe(false);
  });
  it("touches nothing when an entry is a symlink, badly named or lacks a description", () => {
    seed();
    write("p/commands/My Cmd.md", "---\ndescription: x\n---\n");
    expect(() => run()).toThrow(/My Cmd/);
    rmSync(at("p/commands/My Cmd.md"));
    write("target.md", "---\ndescription: x\n---\n");
    symlinkSync(at("target.md"), at("p/commands/link.md"));
    expect(() => run()).toThrow(/link\.md.*symlink/);
    rmSync(at("p/commands/link.md"));
    write("p/agents/rev.md", "---\nname: rev\n---\n");
    expect(() => run()).toThrow(/rev\.md.*description/);
    expect(existsSync(at("store"))).toBe(false);
  });
  it("refuses a symlinked category folder, a link inside a skill and broken YAML, naming the entry", () => {
    seed();
    write("outside/evil.md", "---\ndescription: x\n---\n");
    rmSync(at("p/agents"), { recursive: true });
    symlinkSync(at("outside"), at("p/agents"));
    expect(() => run()).toThrow(/evil\.md.*outside the plugin/);
    rmSync(at("p/agents"));
    write("p/agents/rev.md", "---\ndescription: [oops\n---\n");
    expect(() => run()).toThrow(/rev\.md.*invalid frontmatter/);
    write("p/agents/rev.md", "---\ndescription: Reviews\n---\n");
    symlinkSync(at("outside"), at("p/skills/tdd/scripts/link"));
    expect(() => run()).toThrow(/link.*symlinks/);
    expect(existsSync(at("store"))).toBe(false);
  });
  it("keeps the body and the author's other keys with a BOM and CRLF", () => {
    seed();
    write("p/commands/ship.md", "\u{FEFF}---\r\ndescription: Ship\r\nallowed-tools: Bash\r\natril:\r\n  x: 1\r\n---\r\nline\r\n");
    run();
    const stored = parseArtifact(at("store/commands/kit__ship.md"));
    expect(stored.body).toBe("line\r\n");
    expect(stored.atril).toEqual({ x: 1, plugin: "kit" });
    expect(readFileSync(at("store/commands/kit__ship.md"), "utf8")).toContain("allowed-tools: Bash");
  });
  it("lets an optional rewrite hook change the body and the frontmatter of every entry", () => {
    seed();
    const seen = [];
    const rewrite = ({ entry, front, body }) => {
      seen.push(entry.ref);
      return { front: { ...front, "allowed-tools": "Bash(ls)" }, body: body.toUpperCase() };
    };
    installPluginMarkdown(at("p"), opts(), { rewrite });
    expect(seen).toEqual(["kit:tdd", "kit:ship", "kit:rev"]);
    const stored = parseArtifact(at("store/commands/kit__ship.md"));
    expect(stored.body).toBe("SHIP IT\n");
    expect(readFileSync(at("store/skills/kit__tdd/SKILL.md"), "utf8")).toContain("allowed-tools: Bash(ls)");
  });
  it("stores the same bytes with no hook as with an identity hook", () => {
    seed();
    run();
    const plain = readFileSync(at("store/commands/kit__ship.md"), "utf8");
    rmSync(at("store"), { recursive: true });
    installPluginMarkdown(at("p"), opts(), { rewrite: ({ front, body }) => ({ front, body }) });
    expect(readFileSync(at("store/commands/kit__ship.md"), "utf8")).toBe(plain);
  });
  it("touches nothing when the rewrite hook throws", () => {
    seed();
    const rewrite = (staged) => {
      if (staged.entry.kind === "agent") throw new Error("boom");
      return staged;
    };
    expect(() => installPluginMarkdown(at("p"), opts(), { rewrite })).toThrow(/boom/);
    expect(existsSync(at("store"))).toBe(false);
  });
  it("returns no entries for a plugin with no Markdown", () => {
    write("p/.claude-plugin/plugin.json", JSON.stringify({ name: "kit" }));
    expect(run()).toEqual({ plugin: "kit", entries: [] });
  });
});
