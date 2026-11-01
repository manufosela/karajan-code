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

// GitHub counts these as passing for a required check.
const PASSING = new Set(["success", "neutral", "skipped"]);

/** The pull request that merged this commit into the branch, if any. */
function mergedInto(pulls, branch) {
  return pulls.find((p) => p.merged_at && p.base?.ref === branch) ?? null;
}

async function auditCommit(sha, { branch, requiredChecks, api }) {
  const pull = mergedInto(await api.pullsOf(sha), branch);
  if (!pull) return { sha, kind: "direct-push", detail: `no pull request merged into ${branch}` };
  const results = await api.checksOf(pull.head.sha);
  const passed = new Set(results.filter((c) => PASSING.has(c.conclusion)).map((c) => c.name));
  const missing = requiredChecks.filter((name) => !passed.has(name));
  if (missing.length === 0) return null;
  return { sha, kind: "checks-skipped", pr: pull.number, mergedBy: pull.merged_by?.login ?? "unknown", missing };
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
 * @param {{ branch: string, commits: string[], requiredChecks: string[], api: object }} opts
 * @returns {Promise<{ ok: boolean, merges: object[], protection: string[] }>}
 */
export async function auditMain({ branch, commits, requiredChecks, api }) {
  if (!requiredChecks?.length) throw new Error("main-guard: declare at least one required check to audit against");
  const merges = [];
  for (const sha of commits) {
    const finding = await auditCommit(sha, { branch, requiredChecks, api });
    if (finding) merges.push(finding);
  }
  const protection = auditProtection(await api.protection(), { branch, requiredChecks });
  return { ok: merges.length === 0 && protection.length === 0, merges, protection };
}
