/**
 * atril import --from openskills (ADR 0021, decision 12; plan step 11d): the skills OpenSkills
 * installed into folders the CLIs load on their own (`.claude/skills`, `.agent/skills`) move
 * into atril's store, where they are used on demand. Each one leaves its folder only once it
 * is installed (or the store already holds it, same content); a refusal keeps the original.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { installSkillFolder, refuseLinks } from "./catalog-install.js";
import { parseArtifact } from "./model.js";

const SOURCES = { openskills: [join(".claude", "skills"), join(".agent", "skills")] };

/**
 * @param {string} from where the skills come from: "openskills"
 * @param {{ projectDir?: string, root?: string, env?: object }} [opts]
 * @returns {{ kind: string, name: string, path: string, status: string, from: string }[]}
 */
export function importSkills(from, opts = {}) {
  if (!Object.hasOwn(SOURCES, from)) throw new Error(`atril imports from ${Object.keys(SOURCES).join(", ")}, not "${from}"`);
  const projectDir = opts.projectDir ?? process.cwd();
  const done = [];
  for (const rel of SOURCES[from]) {
    const base = join(projectDir, rel);
    if (!existsSync(base)) continue;
    // A symlinked entry stays in the list so refuseLinks() refuses it out loud, before any read.
    const entries = readdirSync(base, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .toSorted();
    for (const name of entries) {
      const folder = join(base, name);
      refuseLinks(folder);
      if (!existsSync(join(folder, "SKILL.md"))) continue;
      const artifact = parseArtifact(join(folder, "SKILL.md"), { defaultKind: "skill" });
      if (artifact.kind !== "skill" || artifact.name !== name) {
        throw new Error(`${folder}: an imported skill must be kind skill and named after its folder, not "${artifact.name}"`);
      }
      const result = installSkillFolder(folder, opts, Boolean(artifact.kindDefaulted));
      rmSync(folder, { recursive: true });
      done.push({ ...result, from: join(rel, name) });
    }
  }
  return done;
}
