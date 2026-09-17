/**
 * KJC-TSK-0850 (ADR 0010, RAG-D) — index coverage as a defect. A gate built
 * on the RAG protects nothing it cannot see, so the sources the indexer's
 * OWN matchers would take (src/, scripts/, bin/, packages/*: the walker
 * takes the whole repo minus the skip segments) are compared against the
 * chunks the store holds for this project, and against the commit the
 * index was stamped with. No config declares the directories twice: the
 * matchers are the single truth, here and in the indexer.
 */
import { execa } from "execa";
import { isAbsolute, relative } from "node:path";
import { detectAdaptersForProject, buildMatchers } from "../lang/registry.js";
import { getLastIndexedCommit, projectSlug } from "./vec-store.js";

/**
 * @param {string} projectDir
 * @param {{db: object}} deps - an open vec store
 * @returns {Promise<{project: string, total: number, indexed: number, missing: string[], stale: string[], lastIndexedCommit: string|null, absent: boolean}>}
 */
export async function ragIndexCoverage(projectDir, { db }) {
  const project = projectSlug(projectDir);
  const matchers = buildMatchers(detectAdaptersForProject(projectDir));
  const { stdout } = await execa("git", ["-C", projectDir, "ls-files", "-z"]);
  const sources = stdout.split("\0").filter((p) => p && matchers.isCodeFile(p) && !matchers.shouldSkip(p));

  const rows = db.prepare("SELECT DISTINCT source FROM chunks WHERE kind = 'code' AND project_slug = ?").all(project);
  const indexed = new Set(rows.map((r) => (isAbsolute(r.source) ? relative(projectDir, r.source) : r.source)));
  const missing = sources.filter((p) => !indexed.has(p));

  const lastIndexedCommit = getLastIndexedCommit(db, project);
  let stale = [];
  if (lastIndexedCommit) {
    // Files the repo changed after the stamp: the delta update has not seen
    // them yet, so what the store says about them is old.
    // The stamp must be an ANCESTOR of HEAD: a commit that still exists but
    // sits on a rewritten branch would diff fine and report selective
    // staleness, when in truth freshness is unknown. Fail closed.
    const ancestor = await execa("git", ["-C", projectDir, "merge-base", "--is-ancestor", lastIndexedCommit, "HEAD"], { reject: false });
    if (ancestor.exitCode !== 0) {
      throw new Error(`the RAG index stamp ${lastIndexedCommit.slice(0, 9)} is not reachable from HEAD — kj rag index --with-sources`);
    }
    const diff = await execa("git", ["-C", projectDir, "diff", "--name-only", lastIndexedCommit, "HEAD"]);
    const changed = new Set(diff.stdout.split("\n").filter(Boolean));
    stale = sources.filter((p) => indexed.has(p) && changed.has(p));
  }

  return { project, total: sources.length, indexed: sources.length - missing.length, missing, stale, lastIndexedCommit, absent: indexed.size === 0 };
}
