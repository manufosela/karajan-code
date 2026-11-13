// kj release propose <version> (ADR 0057, step 2): opens the release issue with what goes out and who answers.
import { execFileSync } from "node:child_process";
import { participantsOf, readReleaseInputs } from "../release/participants.js";
import { renderProposal } from "../release/proposal.js";

const DEADLINE_MS = 4 * 60 * 60 * 1000;
const ghDefault = async (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** @returns {Promise<{ url: string, deadline: string }>} */
export async function releaseProposeCommand({ repo, version, now = Date.now(), gh = ghDefault, git, print = console.log }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Not a version (x.y.z): ${JSON.stringify(version)}`);
  if (!repo) throw new Error("No origin remote: the release issue needs an owner/repo");
  const { tag, head, commits, prs } = await readReleaseInputs({ repo, gh, git });
  const deadline = new Date(now + DEADLINE_MS).toISOString();
  const body = renderProposal({ repo, version, tag, head, ...participantsOf({ commits, prs }), deadline });
  const out = await gh(["api", "--method", "POST", `repos/${repo}/issues`, "-f", `title=Release ${version}`, "-f", `body=${body}`, "-f", "labels[]=release", "--jq", ".html_url"]);
  const url = out.trim();
  print(url);
  return { url, deadline };
}
