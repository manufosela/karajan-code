/**
 * Test helper: set up + tear down an isolated tmp project for an e2e
 * test. Each test gets its own tmpdir, its own KJ_HOME, its own git
 * repo. Cleanup is unconditional (finally) so a failing test never
 * leaks state into the next one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Throws unless `dir` is strictly inside the real system tmpdir.
 * @param {string} dir
 */
export function assertUnderTmp(dir) {
  const tmp = fs.realpathSync(os.tmpdir());
  let target = path.resolve(dir);
  try { target = fs.realpathSync(target); } catch { /* not created yet: use the resolved path */ }
  const rel = path.relative(tmp, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`refusing to delete "${dir}": not under the system tmpdir (${tmp})`);
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.prefix="kj-e2e-"] — tmpdir name prefix
 * @param {string} [opts.spec] — content for SPEC.md (omitted = no SPEC)
 * @returns {{ projectDir: string, kjHome: string, cleanup: () => void }}
 */
export function makeTmpProject({ prefix = "kj-e2e-", spec } = {}) {
  const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); // git answers real paths
  const kjHome = path.join(projectDir, ".karajan");
  fs.mkdirSync(kjHome, { recursive: true });

  // Initialise git so kj's preflight is happy.
  try {
    execSync(`git -C "${projectDir}" init -q -b main`);
    // Local-only identity to avoid touching the developer's global git config.
    execSync(`git -C "${projectDir}" config user.email "e2e@test.local"`);
    execSync(`git -C "${projectDir}" config user.name "e2e"`);
  } catch { /* git missing? tests will fail later with a clearer message */ }

  if (typeof spec === "string") {
    fs.writeFileSync(path.join(projectDir, "SPEC.md"), spec);
    try {
      execSync(`git -C "${projectDir}" add SPEC.md`);
      execSync(`git -C "${projectDir}" commit -q -m "chore: initial spec"`);
    } catch { /* non-fatal */ }
  }

  return {
    projectDir,
    kjHome,
    cleanup: () => {
      assertUnderTmp(projectDir); // outside the system tmpdir: throw, never swallowed
      try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}
