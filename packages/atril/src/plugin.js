/**
 * Plugins on disk (ADR 0021, plan step 13c1). A plugin is found by its manifest,
 * .claude-plugin/plugin.json, .codex-plugin/plugin.json or plugin.json, in that
 * order, and its Markdown half is inventoried with the store's layout. Unlike
 * scanStore, files a CLI would not load (non-.md, dotfiles) are skipped, not
 * rejected; a skill folder without its SKILL.md still throws. Reading only.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isMapping } from "./model.js";
import { LAYOUT } from "./scan.js";

const MANIFESTS = [
  { format: "claude", file: join(".claude-plugin", "plugin.json") },
  { format: "codex", file: join(".codex-plugin", "plugin.json") },
  { format: "agent", file: "plugin.json" },
];

// The name prefixes store names and refs: no path separators, no ":" or "__".
const SAFE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/i;

const findManifest = (dir) => {
  const found = MANIFESTS.find(({ file }) => existsSync(join(dir, file)));
  if (!found) throw new Error(`${dir}: no plugin manifest (${MANIFESTS.map(({ file }) => file).join(", ")})`);
  return { format: found.format, path: join(dir, found.file) };
};

export const detectPluginFormat = (dir) => findManifest(dir).format;

export function readPluginManifest(dir) {
  const { format, path } = findManifest(dir);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: invalid JSON (${error.message})`, { cause: error });
  }
  if (!isMapping(manifest)) throw new Error(`${path}: a manifest must be a JSON object`);
  if (typeof manifest.name !== "string" || !SAFE_NAME.test(manifest.name)) throw new Error(`${path}: a manifest needs a name made of letters, digits and dashes`);
  return { format, name: manifest.name, version: manifest.version, manifest };
}

// A skill is a folder with a SKILL.md; a command or an agent is a .md file. Symlinks are followed.
const isEntry = ({ kind, file }, base, entry) => {
  const at = join(base, entry);
  if (entry.startsWith(".")) return false;
  if (kind !== "skill") return entry.endsWith(".md") && statSync(at).isFile();
  if (!statSync(at).isDirectory()) return false;
  if (!existsSync(join(base, file(entry)))) throw new Error(`${at}: a skill folder needs a SKILL.md`);
  return true;
};

export function listPluginMarkdown(dir) {
  const plugin = readPluginManifest(dir).name;
  return LAYOUT.flatMap((layout) => {
    const base = join(dir, layout.dir);
    if (!existsSync(base)) return [];
    return readdirSync(base)
      .filter((entry) => isEntry(layout, base, entry))
      .map((entry) => {
        const name = layout.name(entry);
        return { kind: layout.kind, name, storeName: `${plugin}__${name}`, ref: `${plugin}:${name}`, path: join(base, entry) };
      })
      .toSorted((a, b) => (a.name < b.name ? -1 : 1));
  });
}
