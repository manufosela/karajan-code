// kj release approve <issue> (HU-4188, ADR 0057 step 5): a person approves a ready release on the phone; only then is it posted and tagged.
import { execFileSync } from "node:child_process";
import { signAct } from "../harden/act-sign.js";
import { humanAct } from "../harden/human-act.js";
import { approvalFiles, renderApproval } from "../release/approval.js";
import { holdLine, readRelease } from "./release-status.js";

const run = (bin) => async (args) => execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
// The candidate becomes an argument of git tag: only a commit sha, never an option like --force.
const SHA = /^[0-9a-f]{7,64}$/;

/** ADR 0018: refused to an agent session, then signed by the phone over the approval's fields. */
async function approveAct(files, { projectDir, kjVersion, summary }) {
  humanAct("release-approve");
  const changes = [{ file: files[0].file, status: "new", summary, diff: summary, truncated: false }];
  return (await signAct("release-approve", { projectDir, kjVersion, files, changes })).signature;
}

/** The proposal of a ready release, read and judged at this moment; once `signed`, still the version and candidate the phone signed. */
async function readyProposal({ repo, issue, clock, gh }, signed) {
  const { proposal, result } = await readRelease({ repo, issue, now: clock(), gh });
  const moved = signed && (proposal.version !== signed.version || proposal.candidate !== signed.candidate);
  if (moved) throw new Error(`release approve: the proposal changed while you signed (now ${proposal.version} at ${String(proposal.candidate).slice(0, 7)}): nothing was posted nor tagged`);
  if (!SHA.test(proposal.candidate)) throw new Error(`release approve: the proposal's candidate is not a commit sha: ${JSON.stringify(proposal.candidate)}`);
  if (result.ready) return proposal;
  const lines = [...result.holds.map(holdLine), ...result.silent.map((login) => `@${login}: silent until ${proposal.deadline}`)];
  throw new Error(`release approve: the release is ${signed ? "no longer" : "not"} ready, nothing was posted nor tagged:\n${lines.join("\n")}`);
}

/** @returns {Promise<{url: string, tag: string}>} */
export async function releaseApproveCommand({ repo, issue, projectDir = process.cwd(), kjVersion = "unknown", clock = Date.now, gh = run("gh"), git = run("git"), act = approveAct, print = console.log }) {
  const { version, candidate } = await readyProposal({ repo, issue, clock, gh });
  const files = approvalFiles({ repo, version, issue, candidate });
  const signature = await act(files, { projectDir, kjVersion, summary: `approve ${repo}@${version} at ${candidate.slice(0, 7)} (issue #${issue})` });
  if (!signature) throw new Error("release approve: the approval needs the phone's signature, and no phone signed it: enroll one with kj identity enroll-phone");
  // A hold or an edit may land, and the deadline pass, while the phone signs: judge the release again, now, before anything goes out.
  await readyProposal({ repo, issue, clock, gh }, { version, candidate });
  const body = renderApproval({ repo, version, issue, candidate, signature });
  const url = String(await gh(["api", "--method", "POST", `repos/${repo}/issues/${issue}/comments`, "-f", `body=${body}`, "--jq", ".html_url"])).trim();
  const tag = `v${version}`;
  await git(["tag", tag, candidate]);
  await git(["push", "origin", tag]);
  print(`✓ signed approval of ${version} posted: ${url}`);
  print(`✓ tagged ${candidate.slice(0, 7)} as ${tag} and pushed it`);
  return { url, tag };
}
