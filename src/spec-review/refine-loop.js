// Refine loop for the spec-reviewer (KJC-PCS-0048 PR 3). Called from
// run-spec-review.js when the user picks [r]efine. Asks the role for a
// rewritten v2, persists v1.md / v2.md, opens $EDITOR for the user to
// tweak, uses a SHA-256 hash diff to flag whether the v2 needs a fresh
// review pass (user modified it) or can proceed as-is.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const sha256 = (s) => crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");

function openEditor(filePath, { logger, openEditorFn = null } = {}) {
  if (openEditorFn) return openEditorFn(filePath);
  const raw = process.env.VISUAL || process.env.EDITOR || "vi"; // same precedence as src/commands/config.js
  const parts = raw.split(/\s+/);
  logger?.info?.(`Opening ${parts[0]} on ${filePath}`);
  return spawnSync(parts[0], [...parts.slice(1), filePath], { stdio: "inherit" }).status === 0;
}

/**
 * Single refine iteration. The outer loop in run-spec-review.js decides
 * whether to re-invoke us based on the returned `hashChanged` flag
 * (re-review the v2 because the user modified it) or accept the v2 as
 * the final spec (`hashChanged === false`).
 *
 * @returns {Promise<{ok, refinedSpec?, hashChanged, error?, v2Path?}>}
 */
export async function runRefinePass({ spec, findings, role, projectDir, taskFile, logger, fs: fsOverride, openEditorFn }) {
  const _fs = fsOverride || fs;
  const refineRes = await role.refineSpec({ spec, findings });
  if (!refineRes.ok) return { ok: false, error: refineRes.error || "refine failed", hashChanged: false };

  let v2Path;
  try {
    const root = projectDir || process.cwd();
    const ts = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const dir = path.join(root, ".reviews", `spec-review-${ts}`);
    await _fs.mkdir(dir, { recursive: true });
    await _fs.writeFile(path.join(dir, "spec-v1.md"), spec, "utf8");
    v2Path = path.join(dir, "spec-v2.md");
    await _fs.writeFile(v2Path, refineRes.refinedSpec, "utf8");
    if (taskFile) {
      // Mirror the v2 next to the user's --task-file so they find it
      // without diving into .reviews/.
      const p = path.parse(taskFile);
      await _fs.writeFile(path.join(p.dir, `${p.name}.v2${p.ext || ".md"}`), refineRes.refinedSpec, "utf8").catch(() => {});
    }
  } catch (err) { return { ok: false, error: `persist failed: ${err.message}`, hashChanged: false }; }

  const before = sha256(refineRes.refinedSpec);
  await openEditor(v2Path, { logger, openEditorFn });
  let after;
  try { after = await _fs.readFile(v2Path, "utf8"); }
  catch (err) { return { ok: false, error: `read v2 failed: ${err.message}`, hashChanged: false }; }
  return { ok: true, refinedSpec: after, hashChanged: before !== sha256(after), v2Path };
}
