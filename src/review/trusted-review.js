/**
 * HU-4270 (KJC-BUG-0586, #4198): who may publish a kj review that counts. GitHub reports MEMBER
 * only to viewers that can see the membership, so the CI token reads a private org member as
 * CONTRIBUTOR or NONE. Such a review still counts when its author can write to the repository;
 * a lookup that fails never counts, and is named. verify-pr and publish-pr judge alike here.
 */

/** The associations that count without asking the repository. */
export const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const WRITERS = new Set(["admin", "maintain", "write"]);
// A GitHub login (or an app's bot), so it is safe to put in the API path.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$/;
// The associations a hidden org membership shows up as.
const HIDDEN = new Set(["CONTRIBUTOR", "NONE"]);

/** The login's permission on the repository, or why it could not be read. */
async function permissionOf(login, { projectDir, run }) {
  if (!LOGIN.test(login)) return { error: "no valid GitHub login" };
  const res = await run("gh", ["api", `repos/{owner}/{repo}/collaborators/${login}/permission`, "--jq", ".permission"], { cwd: projectDir });
  if (res.exitCode !== 0) return { error: `permission lookup failed: ${(res.stderr || res.stdout || "").trim()}` };
  return { permission: (res.stdout || "").trim() };
}

function rejection(login, association, { permission, error }) {
  const why = error ?? `repository permission ${permission}`;
  const hint = HIDDEN.has(association)
    ? `; if ${login} is an org member, their membership may be private: make it public (orgs/<org>/public_members) or give them write access`
    : "";
  return `review by ${login} not counted: association ${association} and ${why}${hint}`;
}

/**
 * The reviews whose author may publish a kj review, and why each other author did not count.
 * The permission is asked once per login.
 * @returns {Promise<{trusted: object[], rejected: string[]}>}
 */
export async function trustedReviews(reviews, { projectDir, run }) {
  const asked = new Map();
  const trusted = [];
  const rejected = new Set();
  for (const r of reviews) {
    if (TRUSTED.has(r.author_association)) { trusted.push(r); continue; }
    const login = String(r.user?.login ?? "");
    if (!asked.has(login)) asked.set(login, await permissionOf(login, { projectDir, run }));
    const lookup = asked.get(login);
    if (WRITERS.has(lookup.permission)) trusted.push(r);
    else rejected.add(rejection(login || "an unknown author", r.author_association, lookup));
  }
  return { trusted, rejected: [...rejected] };
}
