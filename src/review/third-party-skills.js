/**
 * KJC-TSK-1271 (#2753): a third-party repo has no atril store, so its reviewer
 * gets skills the way a store-backed project does, through atril's public API,
 * from a temporary store outside the reviewed repo: atril resolves the reviewer's
 * skill for the detected stack (the reviewer's own store, ~/.atril, counts), and
 * when nothing installed fits, the best catalog skill is installed in the
 * temporary store first. The maintainer's choice (2026-10-29): catalogs too,
 * installed in a temporary folder. Nothing is written in the reviewed repo.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { catalogSync, installFromCatalog, resolve, search } from "@karajan-family/atril";
import { atrilRoleSkills } from "../skills/atril-skills.js";

const ROOT = ".atril";
const defaultAtril = { resolve, search, installFromCatalog, catalogSync };

/**
 * @param {{ stack: {languages: string[], frameworks: string[]}, max: number, catalogs?: string[], atril?: typeof defaultAtril }} opts
 *   catalogs: absolute paths of catalog folders or source files, as in atril.json
 * @returns {Promise<{skills: object[], others: object[], dropped: string[], installed: string[], reason?: string, cleanup: () => void}>}
 *   cleanup() removes the temporary store once the review has read the skills
 */
export async function thirdPartySkills({ stack, max, catalogs = [], atril = defaultAtril }) {
  const relative = catalogs.find((ref) => !isAbsolute(ref));
  if (relative) throw new Error(`catalog "${relative}" must be an absolute path: it would resolve against a temporary folder`);
  const terms = [...stack.frameworks, ...stack.languages];
  if (terms.length === 0) return { skills: [], others: [], dropped: [], installed: [], reason: "no stack detected in the reviewed repo", cleanup: () => {} };
  const dir = mkdtempSync(join(tmpdir(), "kj-3p-skills-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    const opts = { projectDir: dir, root: ROOT };
    mkdirSync(join(dir, ROOT), { recursive: true });
    writeFileSync(join(dir, ROOT, "atril.json"), `${JSON.stringify({ catalogs })}\n`);
    if (catalogs.length) atril.catalogSync(opts);
    const task = `${terms.join(" ")} code review`;
    const resolveSkills = () => atrilRoleSkills({ role: "reviewer", task, projectDir: dir, root: ROOT, max, resolveFn: atril.resolve });
    let found = resolveSkills();
    const installed = [];
    if (found.skills.length === 0) {
      const pick = atril.search(task, { ...opts, kind: "skill", plugins: false }).find((hit) => !hit.installed);
      if (pick) {
        atril.installFromCatalog(`skill:${pick.name}`, opts);
        installed.push(pick.name);
        found = resolveSkills();
      }
    }
    return { ...found, installed, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}
