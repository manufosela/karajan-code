/**
 * Identity lock — store (IDN-A, KJC-TSK-0762, epic KJC-PCS-0079).
 *
 * Each CLONE declares the identity it is worked with: the gh account and the
 * git email. It is per developer, not per project, so it lives in
 * `.karajan/identity.local.yml`, never tracked (this module keeps it in the
 * .gitignore). Born from the 2026-08-20 incident: one `gh` call without an
 * explicit account switch posted as a client account on a public repo.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

export const IDENTITY_FILE = ".karajan/identity.local.yml";

/** @param {string} projectDir */
export function identityPath(projectDir) {
  return join(projectDir, ".karajan", "identity.local.yml");
}

/**
 * @param {string} projectDir
 * @returns {{gh_user: string, git_email: string, declared_at: string}|null}
 */
export function readIdentity(projectDir) {
  const p = identityPath(projectDir);
  if (!existsSync(p)) return null;
  let parsed;
  try {
    parsed = yaml.load(readFileSync(p, "utf8"));
  } catch {
    return null; // corrupt or half-written file = no identity (review catch)
  }
  if (!parsed || typeof parsed !== "object" || !parsed.gh_user || !parsed.git_email) return null;
  return { gh_user: String(parsed.gh_user), git_email: String(parsed.git_email), declared_at: String(parsed.declared_at || "") };
}

/**
 * Write the declaration and make sure it never gets tracked. Fails loud on
 * an incomplete identity — a half-declared lock is no lock.
 * @param {string} projectDir
 * @param {{gh_user: string, git_email: string}} identity
 */
export function writeIdentity(projectDir, identity) {
  for (const field of ["gh_user", "git_email"]) {
    if (!identity?.[field] || typeof identity[field] !== "string") {
      throw new Error(`identity: "${field}" is required (got ${JSON.stringify(identity?.[field])})`);
    }
  }
  // Ignore FIRST, write SECOND (review catch): if the ignore step fails, no
  // unignored identity file is ever left on disk for git to pick up.
  ensureIgnored(projectDir);
  mkdirSync(join(projectDir, ".karajan"), { recursive: true });
  const record = { gh_user: identity.gh_user, git_email: identity.git_email, declared_at: new Date().toISOString() };
  writeFileSync(identityPath(projectDir), yaml.dump(record, { lineWidth: 120 }), "utf8");
  return record;
}

function ensureIgnored(projectDir) {
  const ignorePath = join(projectDir, ".gitignore");
  const current = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
  if (current.split("\n").some((line) => line.trim() === IDENTITY_FILE)) return;
  const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  writeFileSync(ignorePath, `${current}${sep}${IDENTITY_FILE}\n`, "utf8");
}
