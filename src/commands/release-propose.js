// kj release propose <version> (ADR 0057, step 2): opens the release issue with what goes out and who answers.
import { execFileSync } from "node:child_process";
import { resolveBaseBranch } from "../config/base-branch.js";
import { participantsOf, readReleaseInputs } from "../release/participants.js";
import { renderProposal } from "../release/proposal.js";

const DEADLINE_MS = 4 * 60 * 60 * 1000;
const ghDefault = async (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** @returns {Promise<{ url: string, deadline: string }>} */
export async function releaseProposeCommand({ repo, version, base, now = Date.now(), gh = ghDefault, git, print = console.log, resolveBase = resolveBaseBranch }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Not a version (x.y.z): ${JSON.stringify(version)}`);
  if (!repo) throw new Error("No origin remote: the release issue needs an owner/repo");
  // The project's base as every kj command reads it: the loaded config's base_branch, else origin/HEAD.
  const branch = base ?? (await resolveBase(process.cwd()));
  const { tag, head, local, commits, prs } = await readReleaseInputs({ repo, gh, git, base: branch });
  // KJC-BUG-0615: said, never silent: what was proposed is origin/<base>, not the tree it ran in.
  if (local && local !== head) print(`! HEAD ${local.slice(0, 7)} is not origin/${branch} (${head.slice(0, 7)}): the candidate is origin/${branch}`);
  const deadline = new Date(now + DEADLINE_MS).toISOString();
  const body = renderProposal({ repo, version, tag, head, ...participantsOf({ commits, prs }), deadline });
  const out = await gh(["api", "--method", "POST", `repos/${repo}/issues`, "-f", `title=Release ${version}`, "-f", `body=${body}`, "-f", "labels[]=release", "--jq", ".html_url"]);
  const url = out.trim();
  print(url);
  return { url, deadline };
}
