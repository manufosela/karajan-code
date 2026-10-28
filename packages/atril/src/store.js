/**
 * Install and remove (ADR 0021, decision 5, plan step 7): a local skill
 * folder, command or agent file enters the store under its kind directory,
 * validated first, so a refused artifact leaves the store untouched. An
 * existing artifact is never overwritten: the same content is a no-op,
 * different content fails naming it.
 */
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { forgetInstall, readLock, recordInstall } from "./lock.js";
import { KINDS, SLUG, parseArtifact } from "./model.js";
import { LAYOUT, resolveRoot } from "./scan.js";


function target(name, { kind, root, projectDir = process.cwd(), env = process.env }) {
  if (!KINDS.includes(kind)) throw new Error(`kind ${JSON.stringify(kind)} is not one of ${KINDS.join(", ")}`);
  if (!SLUG.test(name)) throw new Error(`name "${name}" is not a slug (lowercase letters, digits, . _ -)`);
  const base = join(resolve(projectDir, resolveRoot({ root, env })), LAYOUT.find((layout) => layout.kind === kind).dir);
  return join(base, kind === "skill" ? name : `${name}.md`);
}

const sameContent = (a, b) => {
  const aIsDir = statSync(a).isDirectory();
  if (aIsDir !== statSync(b).isDirectory()) return false;
  if (!aIsDir) return readFileSync(a).equals(readFileSync(b));
  const entries = readdirSync(a).toSorted();
  return entries.join("\n") === readdirSync(b).toSorted().join("\n") && entries.every((e) => sameContent(join(a, e), join(b, e)));
};

/**
 * @param {string} ref a local path: a skill folder, or a command or agent .md file
 * @param {{ kind?: string, root?: string, projectDir?: string, env?: object, replace?: boolean }} [opts] `origin` is what the lockfile records (default local, no path); `replace` swaps different content in atomically
 * @returns {{ kind: string, name: string, path: string, status: "installed" | "unchanged" }}
 */
export function install(ref, opts = {}) {
  const origin = opts.origin ?? { origin: "local" };
  const source = resolve(opts.projectDir ?? process.cwd(), ref);
  if (!existsSync(source)) throw new Error(`${source} does not exist`);
  // cpSync keeps a symlink source as a link: the stored artifact would follow its target.
  if (lstatSync(source).isSymbolicLink()) throw new Error(`${source}: an artifact may not be a symlink`);
  const isFolder = statSync(source).isDirectory();
  const file = isFolder ? join(source, "SKILL.md") : source;
  if (isFolder && !existsSync(file)) throw new Error(`${source}: a skill folder needs a SKILL.md`);
  const link = isFolder && readdirSync(source, { recursive: true, withFileTypes: true }).find((e) => e.isSymbolicLink());
  if (link) throw new Error(`${join(link.parentPath, link.name)}: a skill may not hold symlinks`);
  const { kind, name } = parseArtifact(file);
  if (isFolder !== (kind === "skill")) throw new Error(`${source}: a ${kind} must be a ${kind === "skill" ? "folder" : "file"}`);
  if (opts.kind && opts.kind !== kind) throw new Error(`${file}: declares kind ${kind}, not ${opts.kind}`);
  const path = target(name, { ...opts, kind });
  const held = existsSync(path);
  if (held && sameContent(source, path)) {
    // Never rewrites an existing origin unless replacing; otherwise only fills a missing record.
    if (opts.replace || !Object.hasOwn(readLock(opts).artifacts, `${kind}:${name}`)) recordInstall({ kind, name, path }, origin, opts);
    return { kind, name, path, status: "unchanged" };
  }
  if (held && !opts.replace) throw new Error(`${kind}:${name} already exists at ${path} with different content; remove it first`);
  // `replace` stages the copy in a hidden sibling (scanStore skips dot names) and moves the old one aside, so a failure puts it back.
  const hidden = (tag) => join(dirname(path), `.${basename(path)}.${tag}.${randomUUID()}`);
  const [staged, aside] = ["new", "old"].map(hidden);
  try {
    if (held) {
      cpSync(source, staged, { recursive: true });
      renameSync(path, aside);
      renameSync(staged, path);
    } else {
      cpSync(source, path, { recursive: true });
    }
    recordInstall({ kind, name, path }, origin, opts);
  } catch (err) {
    rmSync(staged, { recursive: true, force: true });
    if (existsSync(aside)) {
      rmSync(path, { recursive: true, force: true });
      renameSync(aside, path);
    } else if (!held) {
      rmSync(path, { recursive: true, force: true });
    }
    throw err;
  }
  rmSync(aside, { recursive: true, force: true });
  return { kind, name, path, status: "installed" };
}

/**
 * @param {string} name
 * @param {{ kind: string, root?: string, projectDir?: string, env?: object }} opts
 * @returns {{ kind: string, name: string, path: string }}
 */
export function remove(name, opts) {
  const path = target(name, opts);
  const key = `${opts.kind}:${name}`;
  // Reading first validates the lock before anything is deleted.
  const tracked = Object.hasOwn(readLock(opts).artifacts, key);
  if (!existsSync(path) && !tracked) throw new Error(`${key} is not installed in ${path}`);
  // Delete, then forget: a failure in between leaves the entry, so a retry finishes the job.
  rmSync(path, { recursive: true, force: true });
  forgetInstall(key, opts);
  return { kind: opts.kind, name, path };
}
