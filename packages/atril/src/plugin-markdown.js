/**
 * A plugin's Markdown half into the store (ADR 0021, plan step 13c2). Each skill, command
 * and agent of the plugin's cached copy lands as <plugin>__<name>, marked `atril.plugin`,
 * all or nothing: every entry is checked and staged before the store is touched, and an
 * install that fails removes what this call installed. Library only: the CLI comes later.
 */
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import yaml from "js-yaml";
import { refuseLinks } from "./catalog-install.js";
import { FRONTMATTER, SLUG, isMapping, parseArtifact } from "./model.js";
import { listPluginMarkdown, readPluginManifest } from "./plugin.js";
import { install, remove } from "./store.js";

// Copies one entry into the staging folder with the frontmatter the store needs: the
// store name, the kind (Claude plugin commands carry neither) and its plugin. The body is untouched
// unless `rewrite` changes it: it gets { entry, front, body } and returns the { front, body } to write.
function stageEntry(entry, plugin, stage, inside, rewrite) {
  const { kind, storeName, path } = entry;
  if (!SLUG.test(storeName)) throw new Error(`${path}: store name "${storeName}" is not a slug (lowercase letters, digits, . _ -)`);
  const isSkill = kind === "skill";
  if (isSkill) refuseLinks(path);
  else if (lstatSync(path).isSymbolicLink()) throw new Error(`${path}: an artifact may not be a symlink`);
  // A symlinked commands/, agents/ or skills/ folder would pull in files from outside the plugin.
  if (!realpathSync(path).startsWith(inside)) throw new Error(`${path}: resolves outside the plugin`);
  const staged = join(stage, kind, isSkill ? storeName : `${storeName}.md`);
  mkdirSync(dirname(staged), { recursive: true });
  if (isSkill) cpSync(path, staged, { recursive: true });
  const file = isSkill ? join(staged, "SKILL.md") : staged;
  const match = FRONTMATTER.exec(readFileSync(isSkill ? join(path, "SKILL.md") : path, "utf8").replace(/^\u{FEFF}/u, ""));
  let front;
  try {
    front = match ? yaml.load(match[1]) ?? {} : {};
  } catch (error) {
    throw new Error(`${path}: invalid frontmatter (${error.message})`, { cause: error });
  }
  if (!isMapping(front) || typeof front.description !== "string" || !front.description.trim()) throw new Error(`${path}: needs a description in its frontmatter`);
  if (front.atril !== undefined && !isMapping(front.atril)) throw new Error(`${path}: atril must be a mapping`);
  const { front: next, body } = rewrite({ entry, front, body: match[2] });
  writeFileSync(file, `---\n${yaml.dump({ ...next, name: storeName, kind, atril: { ...next.atril, plugin } }, { lineWidth: -1 })}---\n${body}`);
  parseArtifact(file);
  return staged;
}

/**
 * @param {string} dir the plugin's cached copy
 * @param {{ root?: string, projectDir?: string, env?: object }} [opts] the store, as install() takes it
 * @param {{ rewrite?: (staged: { entry: object, front: object, body: string }) => { front: object, body: string } }} [how]
 *   `rewrite` runs in the preflight, before the store is touched; the default leaves every entry as it is
 * @returns {{ plugin: string, entries: { kind: string, name: string, ref: string, path: string, status: "installed" | "unchanged" }[] }}
 */
export function installPluginMarkdown(dir, opts = {}, { rewrite = (staged) => staged } = {}) {
  const { name: plugin } = readPluginManifest(dir);
  const stage = mkdtempSync(join(tmpdir(), "atril-plugin-"));
  const created = [];
  try {
    const inside = join(realpathSync(dir), sep);
    const staged = listPluginMarkdown(dir).map((entry) => ({ entry, source: stageEntry(entry, plugin, stage, inside, rewrite) }));
    const entries = staged.map(({ entry, source }) => {
      const done = install(source, { ...opts, kind: entry.kind });
      if (done.status === "installed") created.push(done);
      return { kind: entry.kind, name: entry.storeName, ref: entry.ref, path: done.path, status: done.status };
    });
    return { plugin, entries };
  } catch (error) {
    const left = created.toReversed().flatMap(({ kind, name, path }) => {
      try { remove(name, { ...opts, kind }); return []; } catch { return [path]; }
    });
    if (left.length) throw new Error(`${error.message}; rollback left behind: ${left.join(", ")}`, { cause: error });
    throw error;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
