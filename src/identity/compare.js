/**
 * Identity lock — compare (IDN-A, KJC-TSK-0762). Pure: declared vs effective
 * → {ok, mismatches}. Every mismatch carries the LITERAL remedy, because the
 * gate (IDN-B) and the hooks (IDN-C) print it instead of auto-switching —
 * changing the user's keyring is the user's act, never the agent's.
 */

/**
 * @param {{gh_user: string, git_email: string}|null} declared
 * @param {{gh_user: string|null, git_email: string|null}} effective
 * @returns {{ok: boolean, mismatches: Array<{field: string, declared: string|null, effective: string|null, remedy: string}>}}
 */
export function compareIdentity(declared, effective) {
  if (!declared) {
    return {
      ok: false,
      mismatches: [{ field: "identity", declared: null, effective: null, remedy: "kj identity set — this clone has no declared identity yet" }],
    };
  }
  const mismatches = [];
  if (effective.gh_user !== declared.gh_user) {
    mismatches.push({
      field: "gh_user",
      declared: declared.gh_user,
      effective: effective.gh_user ?? null,
      remedy: effective.gh_user ? `gh auth switch --user ${declared.gh_user}` : `gh auth login (as ${declared.gh_user}) or gh auth switch --user ${declared.gh_user}`,
    });
  }
  if (effective.git_email !== declared.git_email) {
    mismatches.push({
      field: "git_email",
      declared: declared.git_email,
      effective: effective.git_email ?? null,
      remedy: `git config user.email ${declared.git_email} (or -c user.email=${declared.git_email} on the command)`,
    });
  }
  return { ok: mismatches.length === 0, mismatches };
}
