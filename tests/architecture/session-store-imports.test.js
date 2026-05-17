/**
 * Architecture guard: every file that calls a `session/store.js` function
 * MUST also import it.
 *
 * Pre-fix, `iteration-loop.js` called `saveSession(session)` (line 382)
 * but only imported `markSessionStatus, addCheckpoint`. The bug stayed
 * dormant until the specific code path that hits that line ran end-to-
 * end (reviewer rejecting an issue the user could see in their run),
 * at which point the orchestrator threw a ReferenceError, escalated to
 * Solomon, and Solomon — correctly — refused to "resolve" what is
 * obviously a missing import. We lost the run, the user lost trust.
 *
 * This test scans every JS file under `src/` and asserts that any
 * symbol from the session store's public API used as a CALL must be
 * imported in the same file (either statically or dynamically). It
 * doesn't catch every shape of bug (passing the function as a value,
 * invoking via a property bag, eval-style stuff) but it catches the
 * exact class of bug we just hit, and at near-zero runtime cost.
 *
 * If this test fires for a NEW symbol you legitimately added, the fix
 * is to add the import — not to change the test.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_DIR = path.join(REPO_ROOT, "src");
const STORE_PATH = path.join(SRC_DIR, "session", "store.js");

/** Discover every name `export`-ed from session/store.js. */
function readStoreExports() {
  const src = fs.readFileSync(STORE_PATH, "utf8");
  const names = new Set();
  // export function NAME / export async function NAME / export const NAME
  const re = /export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return names;
}

function listJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsFiles(p, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(p);
  }
  return out;
}

/**
 * Order matters: strip LINE comments first, then block comments.
 *
 * The naive "block then line" order has a known false-positive: a line
 * comment containing the literal `/*` (e.g. `// drivers/*` documenting a
 * glob) will be the start anchor for the lazy block-comment regex,
 * which then gobbles every line until the next `*\/` — possibly hundreds
 * of lines below. That ate the entire `import { ... } from
 * "../session/store.js"` block in flow-runner.js the first time this
 * guard ran and produced a confidence-shaking false alarm.
 *
 * Stripping `//` line comments first removes the misleading `/*`
 * substring before the block regex sees it.
 */
function stripCommentsAndStrings(source) {
  let out = source.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  return out;
}

/**
 * Heuristic "is this name imported?" — accepts:
 *   - static `import { NAME } from "..."` / `import { NAME as alias } ...`
 *   - dynamic `const { NAME } = await import("...")` / `({ NAME } = await import...)`
 *   - destructuring renames `{ saveSession: save }` (NAME present on left)
 *   - existing local `function NAME` / `const NAME =` (in case it was redefined)
 */
function isResolvedInFile(name, src) {
  const importRe = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`, "m");
  if (importRe.test(src)) return true;
  const dynRe = new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*await\\s+import`, "m");
  if (dynRe.test(src)) return true;
  const localRe = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?(?:function|const|let|var)\\s+${name}\\b`, "m");
  if (localRe.test(src)) return true;
  return false;
}

describe("architecture / session/store imports", () => {
  const exports = readStoreExports();

  it("session/store.js exports the symbols this guard expects to find", () => {
    // Sanity check: regression-prone API. If the store was ever renamed/split,
    // this test surfaces it before the per-file scan starts producing noise.
    for (const expected of ["saveSession", "loadSession", "createSession", "addCheckpoint", "markSessionStatus"]) {
      expect(exports.has(expected), `session/store.js should export ${expected}`).toBe(true);
    }
  });

  it("every src file calling a session/store function imports it", () => {
    const offenders = [];
    for (const file of listJsFiles(SRC_DIR)) {
      // Don't lint the store itself — its own exports are by definition resolved.
      if (file === STORE_PATH) continue;
      const src = stripCommentsAndStrings(fs.readFileSync(file, "utf8"));
      for (const name of exports) {
        // Look for `name(` — the call shape that would throw ReferenceError.
        const callRe = new RegExp(`\\b${name}\\s*\\(`);
        if (!callRe.test(src)) continue;
        if (!isResolvedInFile(name, src)) {
          offenders.push({ file: path.relative(REPO_ROOT, file), name });
        }
      }
    }
    const list = offenders.map((o) => `  ${o.file}: calls ${o.name}() but doesn't import it`).join("\n");
    expect(
      offenders,
      `Found ${offenders.length} call(s) to session/store functions without a matching import.\n` +
      `This is the exact bug class that broke the demo on 2026-04-27 — fix by adding the import:\n\n` +
      list,
    ).toEqual([]);
  });
});
