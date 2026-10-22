/**
 * Store discovery (ADR 0021, decision 8). A store has one directory per kind,
 * the layout the CLIs use: skills/<name>/SKILL.md, commands/<name>.md and
 * agents/<name>.md. The root is an input; a user-level store is scanned too,
 * and the project's artifact wins a clash. A scan never writes.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArtifact } from "./model.js";

export const DEFAULT_ROOT = ".atril";

/** The option wins, then ATRIL_ROOT, then `.atril/`. */
export const resolveRoot = ({ root, env = process.env } = {}) => root ?? env.ATRIL_ROOT ?? DEFAULT_ROOT;

const LAYOUT = [
  { kind: "skill", dir: "skills", file: (entry) => join(entry, "SKILL.md") },
  { kind: "command", dir: "commands", file: (entry) => (entry.endsWith(".md") ? entry : null) },
  { kind: "agent", dir: "agents", file: (entry) => (entry.endsWith(".md") ? entry : null) },
];

function scanStore(root) {
  const found = [];
  for (const { kind, dir, file } of LAYOUT) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base).toSorted()) {
      const rel = file(entry);
      if (!rel || !existsSync(join(base, rel))) continue;
      const artifact = parseArtifact(join(base, rel));
      if (artifact.kind !== kind) {
        throw new Error(`${artifact.path}: declares kind ${artifact.kind} but lives in ${dir}/`);
      }
      found.push(artifact);
    }
  }
  return found;
}

/**
 * @param {{ projectDir?: string, root?: string, userRoot?: string, env?: object }} [opts]
 * @returns {{ artifacts: object[], shadowed: { kind: string, name: string, path: string }[] }}
 */
export function scan({ projectDir = process.cwd(), root, userRoot, env = process.env } = {}) {
  const projectRoot = resolve(projectDir, resolveRoot({ root, env }));
  const userStore = userRoot ?? env.ATRIL_USER_ROOT ?? join(homedir(), DEFAULT_ROOT);
  const artifacts = scanStore(projectRoot);
  const taken = new Set(artifacts.map((a) => `${a.kind}:${a.name}`));
  const shadowed = [];
  if (resolve(userStore) !== projectRoot) {
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
