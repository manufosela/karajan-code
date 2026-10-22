/**
 * Store discovery (ADR 0021, decision 8). A store has one directory per kind,
 * the layout the CLIs use: skills/<name>/SKILL.md, commands/<name>.md and
 * agents/<name>.md. The root is an input; a user-level store is scanned too,
 * and the project's artifact wins a clash. Anything in a kind directory that
 * is not a valid artifact fails loudly, and a scan never writes.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArtifact } from "./model.js";

export const DEFAULT_ROOT = ".atril";

/** The option wins, then ATRIL_ROOT (when not empty), then `.atril/`. */
export const resolveRoot = ({ root, env = process.env } = {}) => root || env.ATRIL_ROOT || DEFAULT_ROOT;

// Each kind: its directory, and how an entry maps to its file and its name.
const LAYOUT = [
  { kind: "skill", dir: "skills", file: (entry) => join(entry, "SKILL.md"), name: (entry) => entry },
  { kind: "command", dir: "commands", file: (entry) => entry, name: (entry) => entry.replace(/\.md$/, "") },
  { kind: "agent", dir: "agents", file: (entry) => entry, name: (entry) => entry.replace(/\.md$/, "") },
];

function scanStore(root) {
  const found = [];
  for (const { kind, dir, file, name } of LAYOUT) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base).toSorted()) {
      const path = join(base, file(entry));
      if (kind !== "skill" && !entry.endsWith(".md")) throw new Error(`${path}: a ${kind} must be a .md file`);
      if (!existsSync(path)) throw new Error(`${join(base, entry)}: a skill folder needs a SKILL.md`);
      const artifact = parseArtifact(path);
      if (artifact.kind !== kind) throw new Error(`${path}: declares kind ${artifact.kind} but lives in ${dir}/`);
      if (artifact.name !== name(entry)) throw new Error(`${path}: declares name "${artifact.name}" but is named "${name(entry)}"`);
      found.push(artifact);
    }
  }
  return found;
}

/**
 * @param {{ projectDir?: string, root?: string, userRoot?: string, env?: object }} [opts]
 *   userRoot defaults to ATRIL_USER_ROOT, then ~/.atril; relative roots resolve against projectDir.
 * @returns {{ artifacts: object[], shadowed: { kind: string, name: string, path: string }[] }}
 */
export function scan({ projectDir = process.cwd(), root, userRoot, env = process.env } = {}) {
  const projectRoot = resolve(projectDir, resolveRoot({ root, env }));
  const userStore = resolve(projectDir, userRoot || env.ATRIL_USER_ROOT || join(homedir(), DEFAULT_ROOT));
  const artifacts = scanStore(projectRoot);
  const shadowed = [];
  if (userStore !== projectRoot) {
    const taken = new Set(artifacts.map((artifact) => `${artifact.kind}:${artifact.name}`));
    for (const artifact of scanStore(userStore)) {
      if (taken.has(`${artifact.kind}:${artifact.name}`)) {
        shadowed.push({ kind: artifact.kind, name: artifact.name, path: artifact.path });
      } else {
        artifacts.push(artifact);
      }
    }
  }
  return { artifacts, shadowed };
}
