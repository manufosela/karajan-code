// kj release status <issue> (ADR 0057, step 3): who confirmed, who holds, who is silent, whether it is ready.
import { execFileSync } from "node:child_process";
import { evaluateRelease } from "../release/answers.js";
import { parseProposal } from "../release/proposal.js";

const ghDefault = async (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const mentions = (logins) => logins.map((login) => `@${login}`).join(", ");

function verdictLine(result, proposal) {
  if (result.ready) return "Ready: the release can go out.";
  if (result.holds.length > 0) return `Not ready: waiting for ${mentions(result.holds.map((h) => h.login))} to lift the hold.`;
  return `Not ready: waiting for ${mentions(result.silent)} until ${proposal.deadline}.`;
}

export function holdLine({ login, decision, why }) {
  const reason = why ? ` (${why})` : "";
  return `@${login}: ${decision}${reason}`;
}

/** The release issue's proposal, its comments and the verdict on them (also read by kj release approve). */
export async function readRelease({ repo, issue, now = Date.now(), gh = ghDefault }) {
  if (!Number.isInteger(issue) || issue <= 0) throw new Error(`Not an issue number: ${JSON.stringify(issue)}`);
  if (!repo) throw new Error("No origin remote: the release issue needs an owner/repo");
  const { body } = JSON.parse(await gh(["api", `repos/${repo}/issues/${issue}`]));
  const proposal = parseProposal(body);
  const out = await gh(["api", "--paginate", `repos/${repo}/issues/${issue}/comments`, "--jq", ".[] | {login: .user.login, body, createdAt: .created_at}"]);
  const comments = out.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { proposal, comments, result: evaluateRelease({ proposal, comments, now }) };
}

export async function releaseStatusCommand({ repo, issue, now = Date.now(), gh = ghDefault, print = console.log }) {
  const { proposal, result } = await readRelease({ repo, issue, now, gh });
  for (const login of result.confirmed) print(`@${login}: confirmed`);
  for (const hold of result.holds) print(holdLine(hold));
  for (const login of result.silent) print(`@${login}: silent`);
  print(verdictLine(result, proposal));
  return result;
}
