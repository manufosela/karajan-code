/**
 * KJC-TSK-1117: a review lens changes what the reviewer looks at, not how strict
 * it is (that is review_mode). The qa lens puts a QA rubric before the task, so a
 * PR of test automation is judged on whether its tests would catch bugs.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getTemplatesRoot } from "../utils/templates-root.js";

const RUBRICS = { qa: "reviewer-qa.md" };
export const LENSES = Object.keys(RUBRICS);

/** The reviewer's task under a lens; no lens leaves it as it is. */
export async function lensTask(lens, task) {
  if (!lens) return task;
  if (!Object.hasOwn(RUBRICS, lens)) throw new Error(`unknown review lens "${lens}": use ${LENSES.join(", ")}`);
  const rubric = (await readFile(join(getTemplatesRoot(), "roles", RUBRICS[lens]), "utf8")).trim();
  return task ? `${rubric}\n\n## Task\n\n${task}` : rubric;
}
