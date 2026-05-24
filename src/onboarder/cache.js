// KJC-TSK-0384 PR 3 — read the cached Architecture Brief deterministically.
// briefPath() is exported by src/commands/onboard.js so the writer and
// reader share the same slug rule.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { briefPath } from "../commands/onboard.js";

/**
 * Read the cached Architecture Brief for `projectDir`. Returns:
 *   { found: true,  path, content }  — when the file exists
 *   { found: false, path }           — when it does not
 * Never throws.
 */
export async function readCachedBrief(projectDir) {
  const p = briefPath(projectDir);
  if (!existsSync(p)) return { found: false, path: p };
  try {
    const content = await readFile(p, "utf8");
    return { found: true, path: p, content };
  } catch {
    return { found: false, path: p };
  }
}
