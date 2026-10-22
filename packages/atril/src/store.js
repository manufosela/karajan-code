/**
 * Install and remove (ADR 0021, decision 5, plan step 7): a local skill
 * folder, command or agent file enters the store under its kind directory,
 * validated first, so a refused artifact leaves the store untouched. An
 * existing artifact is never overwritten: the same content is a no-op,
 * different content fails naming it.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { KINDS, SLUG, parseArtifact } from "./model.js";
import { resolveRoot } from "./scan.js";

const DIRS = { skill: "skills", command: "commands", agent: "agents" };

function target(name, { kind, root, projectDir = process.cwd(), env = process.env }) {
  if (!KINDS.includes(kind)) throw new Error(`kind ${JSON.stringify(kind)} is not one of ${KINDS.join(", ")}`);
  if (!SLUG.test(name)) throw new Error(`name "${name}" is not a slug (lowercase letters, digits, . _ -)`);
  const base = join(resolve(projectDir, resolveRoot({ root, env })), DIRS[kind]);
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
 * @param {{ kind?: string, root?: string, projectDir?: string, env?: object }} [opts]
 * @returns {{ kind: string, name: string, path: string, status: "installed" | "unchanged" }}
 */
export function install(ref, opts = {}) {
  const source = resolve(opts.projectDir ?? process.cwd(), ref);
  if (!existsSync(source)) throw new Error(`${source} does not exist`);
  const isFolder = statSync(source).isDirectory();
  const file = isFolder ? join(source, "SKILL.md") : source;
  if (isFolder && !existsSync(file)) throw new Error(`${source}: a skill folder needs a SKILL.md`);
  const { kind, name } = parseArtifact(file);
  if (isFolder !== (kind === "skill")) throw new Error(`${source}: a ${kind} must be a ${kind === "skill" ? "folder" : "file"}`);
  if (opts.kind && opts.kind !== kind) throw new Error(`${file}: declares kind ${kind}, not ${opts.kind}`);
  const path = target(name, { ...opts, kind });
  if (existsSync(path)) {
    if (sameContent(source, path)) return { kind, name, path, status: "unchanged" };
    throw new Error(`${kind}:${name} already exists at ${path} with different content; remove it first`);
  }
  cpSync(source, path, { recursive: true });
  return { kind, name, path, status: "installed" };
}

/**
 * @param {string} name
 * @param {{ kind: string, root?: string, projectDir?: string, env?: object }} opts
 * @returns {{ kind: string, name: string, path: string }}
 */
export function remove(name, opts) {
  const path = target(name, opts);
  if (!existsSync(path)) throw new Error(`${opts.kind}:${name} is not installed in ${path}`);
  rmSync(path, { recursive: true });
  return { kind: opts.kind, name, path };
}
