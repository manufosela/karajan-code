/**
 * KJC-BUG-0408 (#2560): kj reads the diffs git prints for it (privacy, sonar, review, guards),
 * and every parser expects `a/` and `b/`. A user's diff.mnemonicPrefix (c/, i/, w/), noprefix or
 * srcPrefix changed those headers: the suite went red on that machine and the privacy gate saw
 * no file and passed. kj pins the format of the git it runs through the environment (the
 * GIT_CONFIG_COUNT protocol, git >= 2.31), so every child inherits it and no parser depends on
 * the user's gitconfig. The pins are appended after whatever config the environment carries.
 */

// KJC-BUG-0415 (#2622): a verdict binds to the hash of the diff text, so every option that
// changes that text is pinned to git's default too, or the hash kj review --staged records on a
// machine with diff.algorithm=histogram is not the one CI recomputes.
const PINS = [
  ["diff.mnemonicPrefix", "false"],
  ["diff.noprefix", "false"],
  ["diff.srcPrefix", "a/"],
  ["diff.dstPrefix", "b/"],
  ["diff.algorithm", "myers"],
  ["diff.context", "3"],
  ["diff.interHunkContext", "0"],
  ["diff.indentHeuristic", "true"],
  ["diff.suppressBlankEmpty", "false"],
  ["diff.renames", "true"],
  ["diff.relative", "false"],
  ["color.diff", "false"],
];
const PINNED = "KJ_GIT_DIFF_PINNED";

/** Pin git's diff headers to a/ and b/ for every git that inherits `env`; idempotent. */
export function pinGitDiffFormat(env = process.env) {
  if (env[PINNED]) return env;
  const count = Number.parseInt(env.GIT_CONFIG_COUNT ?? "0", 10) || 0;
  PINS.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${count + i}`] = key;
    env[`GIT_CONFIG_VALUE_${count + i}`] = value;
  });
  env.GIT_CONFIG_COUNT = String(count + PINS.length);
  env[PINNED] = "1";
  return env;
}
