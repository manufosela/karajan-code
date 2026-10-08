/**
 * KJC-BUG-0246 (#1893): one git identity for the whole run.
 *
 * Of five commits of one run, three carried one account and two another: the
 * pipeline let git resolve the author at every commit, and the host works with
 * several global identities that other sessions switch at will. The identity
 * is resolved ONCE, before the first commit, in a fixed order: the clone's
 * declaration (`kj identity set`, .karajan/identity.local.yml), else the
 * repository's own config, else the global one. Nothing resolvable is null,
 * never a guess: git itself refuses the commit loudly in that case.
 */
import { execFileSync } from "node:child_process";
import { readIdentity } from "../identity/store.js";

const defaultGitFn = (projectDir, args) =>
  execFileSync("git", ["config", ...args], { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

const configValue = (gitFn, projectDir, args) => {
  try {
    const out = String(gitFn(projectDir, args) || "").trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
};

/**
 * @param {{projectDir: string, gitFn?: (projectDir: string, args: string[]) => string}} opts
 * @returns {{name: string, email: string, source: "declared"|"repo"|"global"}|null}
 */
export function resolveRunIdentity({ projectDir, gitFn = defaultGitFn }) {
  const declared = readIdentity(projectDir);
  const local = (key) => configValue(gitFn, projectDir, ["--local", "--get", `user.${key}`]);
  const effective = (key) => configValue(gitFn, projectDir, ["--get", `user.${key}`]);
  const localEmail = local("email");
  const email = declared?.git_email ?? localEmail ?? effective("email");
  const name = local("name") ?? effective("name");
  if (!email || !name) return null;
  let source = "global";
  if (declared) source = "declared";
  else if (localEmail) source = "repo";
  return { name, email, source };
}

/** The environment that pins author and committer for one git command. */
export const identityEnv = ({ name, email }) => ({
  GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email,
});
