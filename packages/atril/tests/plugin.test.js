// ADR 0021, plan step 13c1: a plugin on disk is read from its manifest
// and its Markdown is inventoried. Reading only: nothing is written.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectPluginFormat, listPluginMarkdown, readPluginManifest } from "../src/plugin.js";

let dir;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-plugin-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (rel, content = "") => {
  const file = join(dir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};
const manifest = (rel, name = "tdd-kit", extra = {}) => write(rel, JSON.stringify({ name, ...extra }));
const root = (rel) => join(dir, rel);

describe("detectPluginFormat", () => {
  it("recognises the claude, codex and agent manifest layouts", () => {
    manifest("claude/.claude-plugin/plugin.json");
    manifest("codex/.codex-plugin/plugin.json");
    manifest("agent/plugin.json");

    expect(detectPluginFormat(root("claude"))).toBe("claude");
    expect(detectPluginFormat(root("codex"))).toBe("codex");
    expect(detectPluginFormat(root("agent"))).toBe("agent");
  });

  it("prefers claude over codex over agent when several manifests exist", () => {
    manifest("p/plugin.json");
    manifest("p/.codex-plugin/plugin.json");
    manifest("p/.claude-plugin/plugin.json");

    expect(detectPluginFormat(root("p"))).toBe("claude");
    rmSync(root("p/.claude-plugin"), { recursive: true });
    expect(detectPluginFormat(root("p"))).toBe("codex");
    rmSync(root("p/.codex-plugin"), { recursive: true });
    expect(detectPluginFormat(root("p"))).toBe("agent");
  });

  it("throws with the path when there is no manifest", () => {
    write("empty/README.md");

    expect(() => detectPluginFormat(root("empty"))).toThrow(root("empty"));
  });
});

describe("readPluginManifest", () => {
  it("reads name, version and format from the detected manifest", () => {
    manifest("p/.codex-plugin/plugin.json", "tdd-kit", { version: "1.2.0" });

    expect(readPluginManifest(root("p"))).toEqual({
      format: "codex",
      name: "tdd-kit",
      version: "1.2.0",
      manifest: { name: "tdd-kit", version: "1.2.0" },
    });
  });

  it("treats version as optional", () => {
    manifest("p/plugin.json");

    expect(readPluginManifest(root("p")).version).toBeUndefined();
  });

  it("rejects a manifest without a usable name, or with invalid JSON", () => {
    write("no-name/plugin.json", "{}");
    for (const bad of ["../evil", "a:b", "a__b", "MyPlugin"]) {
      manifest("unsafe/plugin.json", bad);
      expect(() => readPluginManifest(root("unsafe"))).toThrow(root("unsafe/plugin.json"));
    }
    write("empty-name/plugin.json", JSON.stringify({ name: "" }));
    write("broken/plugin.json", "{not json");

    for (const bad of ["no-name", "empty-name", "broken"]) expect(() => readPluginManifest(root(bad))).toThrow(root(`${bad}/plugin.json`));
    expect(() => readPluginManifest(root("broken"))).toThrow(expect.objectContaining({ cause: expect.any(SyntaxError) }));
  });
});

describe("listPluginMarkdown", () => {
  it("inventories skill folders, commands and agents with their store names and refs", () => {
    manifest("p/plugin.json", "tdd-kit");
    write("p/skills/tdd/SKILL.md");
    write("p/skills/tdd/scripts/run.sh");
    write("p/commands/review.md");
    write("p/commands/.draft.md");
    write("elsewhere/linked.md");
    symlinkSync(root("elsewhere/linked.md"), root("p/commands/linked.md"));
    write("p/commands/notes.txt");
    write("p/agents/tester.md");

    expect(listPluginMarkdown(root("p"))).toEqual([
      { kind: "skill", name: "tdd", storeName: "tdd-kit__tdd", ref: "tdd-kit:tdd", path: root("p/skills/tdd") },
      { kind: "command", name: "linked", storeName: "tdd-kit__linked", ref: "tdd-kit:linked", path: root("p/commands/linked.md") },
      { kind: "command", name: "review", storeName: "tdd-kit__review", ref: "tdd-kit:review", path: root("p/commands/review.md") },
      { kind: "agent", name: "tester", storeName: "tdd-kit__tester", ref: "tdd-kit:tester", path: root("p/agents/tester.md") },
    ]);
  });

  it("throws when a skill folder has no SKILL.md", () => {
    manifest("p/plugin.json");
    write("p/skills/draft/notes.md");

    expect(() => listPluginMarkdown(root("p"))).toThrow(root("p/skills/draft"));
  });

  it("sorts by kind, then by name, and treats missing directories as empty", () => {
    manifest("p/plugin.json");
    write("p/commands/b.md");
    write("p/commands/a-b.md");
    write("p/commands/a.md");
    write("p/skills/z/SKILL.md");

    expect(listPluginMarkdown(root("p")).map((e) => e.ref)).toEqual(["tdd-kit:z", "tdd-kit:a", "tdd-kit:a-b", "tdd-kit:b"]);

    manifest("bare/plugin.json");
    expect(listPluginMarkdown(root("bare"))).toEqual([]);
  });
});
