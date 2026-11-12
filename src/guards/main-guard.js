/**
 * main-guard (KJC-TSK-1368, ADR 0037 layer 2): after a push to the protected branch, what
 * reached it without its required checks, and whether the protection still enforces them on
 * admins. It cannot prevent an abuse by someone holding the maintainer's credentials; it makes
 * it visible. GitHub is reached through an injected api, so the logic runs without network.
 *
 * api.pullsOf(sha)   → pull requests associated with a commit (GitHub's commits/{sha}/pulls)
 * api.checksOf(sha)  → [{ name, conclusion }] for a commit (check runs and statuses)
 * api.protection()   → the branch protection, or null when the branch is not protected
 */

import { findValidException } from "./main-guard-exception.js";

// GitHub counts these as passing for a required check.
const PASSING = new Set(["success", "neutral", "skipped"]);

/** The pull request that merged this commit into the branch, if any. */
function mergedInto(pulls, branch) {
  return pulls.find((p) => p.merged_at && p.base?.ref === branch) ?? null;
}

async function auditCommit(sha, { branch, repo, requiredChecks, keys, passkeys = [], api }) {
  const pull = mergedInto(await api.pullsOf(sha), branch);
  if (!pull) return { sha, kind: "direct-push", detail: `no pull request merged into ${branch}` };
  const results = await api.checksOf(pull.head.sha);
  const passed = new Set(results.filter((c) => PASSING.has(c.conclusion)).map((c) => c.name));
  const missing = requiredChecks.filter((name) => !passed.has(name));
  if (missing.length === 0) return null;
  const finding = { sha, kind: "checks-skipped", pr: pull.number, mergedBy: pull.merged_by?.login ?? "unknown", missing };
  // KJC-TSK-1402: the maintainer's phone-signed exception for this PR and head lets it through, named.
  if (!api.exceptionsOf || (!keys?.size && passkeys.length === 0)) return finding;
  const found = findValidException({ bodies: await api.exceptionsOf(pull.number), repo, pr: pull.number, head: pull.head.sha, keys: keys ?? new Set(), passkeys });
  return found.ok ? { ...finding, kind: "excepted", why: found.why, signer: found.signer } : finding;
}

/** What changed in the protection against what is declared. */
function auditProtection(protection, { branch, requiredChecks }) {
  if (!protection) return [`${branch} is not protected`];
  const changes = [];
  if (!protection.enforce_admins?.enabled) changes.push("enforce_admins is off: admins can merge past the required checks");
  const rules = protection.required_status_checks ?? {};
  const enforced = new Set([...(rules.contexts ?? []), ...(rules.checks ?? []).map((c) => c.context)]);
  for (const name of requiredChecks) if (!enforced.has(name)) changes.push(`required check removed: ${name}`);
  return changes;
}

/**
 * @param {{ branch: string, repo?: string, commits: string[], requiredChecks: string[], keys?: Set<string>, passkeys?: object[], api: object }} opts
 *   keys: the roster's public keys; passkeys: its live passkeys (HU-4014); api.exceptionsOf(pr): the PR's comment bodies (KJC-TSK-1402)
 * @returns {Promise<{ ok: boolean, merges: object[], protection: string[], exceptions?: object[] }>}
 */
export async function auditMain({ branch, repo, commits, requiredChecks, keys, passkeys, api }) {
  if (!requiredChecks?.length) throw new Error("main-guard: declare at least one required check to audit against");
  const merges = [];
  const exceptions = [];
  for (const sha of commits) {
    const finding = await auditCommit(sha, { branch, repo, requiredChecks, keys, passkeys, api });
    if (finding) (finding.kind === "excepted" ? exceptions : merges).push(finding);
  }
  // A change to the protection never takes an exception: it is reported whatever was signed.
  const protection = auditProtection(await api.protection(), { branch, requiredChecks });
  return { ok: merges.length === 0 && protection.length === 0, merges, protection, ...(exceptions.length && { exceptions }) };
}
