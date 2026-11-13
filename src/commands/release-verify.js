// kj release verify <tag> (ADR 0057, step 6): CI checks a tag against its release issue and the signed approval.
import { execFileSync } from "node:child_process";
import { readPasskeyCredentials, readSigners } from "../harden/phone-sign.js";
import { findValidApproval } from "../release/approval.js";
import { mentions, readRelease } from "./release-status.js";

const TAG = /^v(\d+\.\d+\.\d+)$/;
const ghDefault = async (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const gitDefault = (args, cwd) => execFileSync("git", args, { encoding: "utf8", cwd }).trim();
const JQ = ".[] | {number, title, pull: (.pull_request != null)}";

async function releaseIssues({ repo, version, gh }) {
  const out = await gh(["api", "--paginate", `repos/${repo}/issues?labels=release&state=all&per_page=100`, "--jq", JQ]);
  return out.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .filter((entry) => !entry.pull && entry.title === `Release ${version}`).map((entry) => entry.number);
}

/** `{ issue?, reason }`: the first reason the tag may not be published; `{ issue, signer }` when all is in order. */
async function judge({ repo, version, tag, projectDir, now, gh, git, keys, passkeys }) {
  const numbers = await releaseIssues({ repo, version, gh });
  if (numbers.length === 0) return { reason: `no release issue titled "Release ${version}"` };
  if (numbers.length > 1) {
    const refs = numbers.map((n) => `#${n}`).join(", ");
    return { reason: `several release issues for ${version}: ${refs}` };
  }
  const issue = numbers[0];
  const { proposal, comments, result } = await readRelease({ repo, issue, now, gh });
  if (proposal.version !== version) return { issue, reason: `the proposal of #${issue} is for ${proposal.version}, not ${version}` };
  const commit = git(["rev-list", "-n", "1", tag], projectDir);
  if (proposal.candidate !== commit) return { issue, reason: `${tag} points to ${commit.slice(0, 7)}, not the candidate ${String(proposal.candidate).slice(0, 7)}` };
  if (result.holds.length > 0) return { issue, reason: `on hold by ${mentions(result.holds.map((h) => h.login))}` };
  if (!result.ready) return { issue, reason: `not everyone answered: ${mentions(result.silent)} until ${proposal.deadline}` };
  const roster = keys ?? new Set(readSigners({ projectDir }));
  const credentials = passkeys ?? readPasskeyCredentials({ projectDir });
  if (roster.size === 0 && credentials.length === 0) return { issue, reason: "the roster has no signers" };
  const approval = findValidApproval({ bodies: comments.map((c) => c.body), repo, version, issue, candidate: commit, keys: roster, passkeys: credentials });
  return approval.ok ? { issue, signer: approval.signer } : { issue, reason: approval.reason };
}

export async function releaseVerifyCommand({ repo, tag, projectDir, now = Date.now(), gh = ghDefault, git = gitDefault, keys, passkeys, print = console.log }) {
  const version = TAG.exec(tag ?? "")?.[1];
  const verdict = version ? await judge({ repo, version, tag, projectDir, now, gh, git, keys, passkeys }) : { reason: `${JSON.stringify(tag)} is not a release tag (v<x.y.z>)` };
  const result = { ok: !verdict.reason, ...verdict, version };
  print(result.ok ? `release verify: v${version} approved by ${result.signer} (#${result.issue})` : `release verify: ${verdict.reason}`);
  return result;
}
