/**
 * KJC-TSK-1188 (ADR 0021, decisions 5 and 7, step 15a): the core asks atril
 * for a role's skills through its narrow contract, as any third party would.
 * The store is the project's `.karajan/` (skills/, commands/, agents/), the
 * budget is `skills.max_per_role`, and every artifact comes back with the path
 * to read: atril is on demand, nothing is inlined that the CLI can load itself.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolve as atrilResolve } from "@karajan-family/atril";

export const ATRIL_ROOT = ".karajan";
const KIND_DIRS = ["skills", "commands", "agents"];

/** A project has a store when any kind directory exists under `.karajan/`. */
export const hasAtrilStore = (projectDir, root = ATRIL_ROOT) => KIND_DIRS.some((dir) => existsSync(join(projectDir, root, dir)));

/**
 * The block atril resolves for this role and task, in the shape the prompts
 * already consume: `{ skills, dropped }` plus atril's `reason` when nothing
 * matched. Only skills become prompt skills: a command or an agent in the
 * block is a different kind of artifact and comes back apart, under `others`,
 * never disguised as a skill. An invalid store fails loudly, as atril does.
 * @param {{ role: string, task: string, projectDir: string, max: number, root?: string, userRoot?: string, resolveFn?: typeof atrilResolve }} opts
 */
export function atrilRoleSkills({ role, task, projectDir, max, root = ATRIL_ROOT, userRoot, resolveFn = atrilResolve }) {
  const { block, left, reason } = resolveFn({ task, role, projectDir, root, userRoot, budget: { maxArtifacts: max } });
  const skills = block.filter((item) => item.kind === "skill").map(({ name, content, path }) => ({ name, content, path, catalog: true }));
  const others = block.filter((item) => item.kind !== "skill").map(({ name, kind, path }) => ({ name, kind, path }));
  return { skills, others, dropped: left.map((item) => item.name), ...(reason ? { reason } : {}) };
}
