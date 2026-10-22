/**
 * KJC-TSK-1112: the reviewed repo's own allow list for the privacy check of a
 * third-party PR. Only `allow` is read: a personal list never lives in a repo
 * (it is sensitive, see privacy/scan.js). The file is read at the BASE of the
 * range, never at the head, so a PR cannot add the exemption it needs.
 */
import { parse as parseYaml } from "yaml";
import { runCommand } from "../utils/process.js";

const REPO_PRIVACY = ".karajan/privacy.yml";

const baseOf = (range) => {
  const base = String(range).split(/\.{2,3}/)[0];
  if (!base || base === range) throw new Error(`cannot read the base of the range ${range}: pass <base>...<head>`);
  return base;
};

/** The repo's allow list at the base of the range; empty when the base has no such file. */
export async function repoPrivacyAllow({ projectDir, range, run = runCommand }) {
  const base = baseOf(range);
  // KJC-BUG-0387: exit codes, never git's messages, which follow the user's language.
  const git = (...args) => run("git", ["-C", projectDir, ...args]);
  if ((await git("rev-parse", "--verify", "--quiet", `${base}^{commit}`)).exitCode !== 0) {
    throw new Error(`cannot read the privacy allow list: the base ${base} is not a commit here`);
  }
  if ((await git("cat-file", "-e", `${base}:${REPO_PRIVACY}`)).exitCode !== 0) return [];
  const res = await git("show", `${base}:${REPO_PRIVACY}`);
  if (res.exitCode !== 0) throw new Error(`git show ${base}:${REPO_PRIVACY} failed: ${(res.stderr || "").trim()}`);
  let raw;
  try {
    raw = parseYaml(res.stdout) || {};
  } catch (err) {
    throw new Error(`${REPO_PRIVACY} at ${base} is not valid YAML: ${err.message}`, { cause: err });
  }
  return Array.isArray(raw.allow) ? raw.allow.map(String).map((s) => s.trim()).filter(Boolean) : [];
}

/** The user's privacy list with the repo's allow added; the personal list stays the user's own. */
export const withRepoAllow = (list, repoAllow) => ({ ...list, allow: [...list.allow, ...repoAllow] });
