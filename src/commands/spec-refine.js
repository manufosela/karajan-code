/**
 * KJC-TSK-1251: kj spec refine. From a high-level spec, and its e2e tests if there are any, kj
 * proposes a detailed spec (behaviour, edge cases, acceptance criteria tied to the e2e or e2e
 * scenarios proposed, assumptions, open questions) and stops: the user accepts or edits it, and
 * only then kj plan generate turns it into user stories.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { SpecReviewerRole } from "../roles/spec-reviewer-role.js";

/** <name>.detailed.md next to the spec. */
export const detailedPathFor = (taskFile) => join(dirname(taskFile), `${basename(taskFile, extname(taskFile))}.detailed.md`);

/** @returns {Promise<{file: string, gaps: number, e2e: string[]}>} */
export async function specRefineCommand({ taskFile, e2e = [], out = null, config, logger, makeRole = (opts) => new SpecReviewerRole(opts) }) {
  if (!taskFile) throw new Error("kj spec refine needs --task-file <spec.md>");
  const projectDir = config?.projectDir || process.cwd();
  const target = resolve(projectDir, out ?? detailedPathFor(taskFile));
  // Checked before any token is spent; the write below refuses too (wx), whatever happens meanwhile.
  if (existsSync(target)) throw new Error(`${target} already exists: review it, or choose another file with --out`);
  const spec = await readFile(resolve(projectDir, taskFile), "utf8");
  const tests = await Promise.all(e2e.map(async (path) => ({ path, text: await readFile(resolve(projectDir, path), "utf8") })));
  const role = makeRole({ config, logger });
  await role.init({ task: spec });
  const review = await role.execute({ spec });
  if (!review.ok) logger.warn(`kj spec refine: the spec reviewer failed (${review.summary ?? "no answer"}); detailing without its gaps`);
  const findings = review.ok ? review.result?.findings ?? [] : [];
  const detailed = await role.detailSpec({ spec, e2e: tests, findings });
  if (!detailed.ok) throw new Error(`the spec could not be detailed: ${detailed.error}`);
  await writeFile(target, `${detailed.detailedSpec}\n`, { flag: "wx" });
  return { file: target, gaps: findings.length, e2e: tests.map((t) => t.path) };
}
