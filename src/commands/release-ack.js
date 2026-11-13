// kj release ack <issue> <decision> (ADR 0057, step 4): answers a release proposal with a compatibility check.
import { execFileSync } from "node:child_process";
import { sanitize } from "../environment/issue-report.js";
import { renderAnswer } from "../release/answers.js";
import { compatCheck } from "../release/compat-check.js";
import { parseProposal } from "../release/proposal.js";

const DECISIONS = ["ok", "hold", "include"];
const ghDefault = async (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const isPositiveInteger = (n) => Number.isInteger(n) && n > 0;

function validate({ repo, issue, decision, why, include }) {
  if (!isPositiveInteger(issue)) throw new Error(`Not an issue number: ${JSON.stringify(issue)}`);
  if (!DECISIONS.includes(decision)) throw new Error(`Not a decision (${DECISIONS.join("|")}): ${JSON.stringify(decision)}`);
  if (decision === "hold" && !String(why ?? "").trim()) throw new Error("A hold needs a non-empty --why");
  if (decision === "include" && include.length === 0) throw new Error("An include needs at least one PR number (--include)");
  const notPrs = include.filter((pr) => !isPositiveInteger(pr));
  if (notPrs.length > 0) throw new Error(`Not a PR number (--include): ${notPrs.map(String).join(", ")}`);
  if (!repo) throw new Error("No origin remote: the release issue needs an owner/repo");
}

/** @returns {Promise<{ url: string, exitCode: number }>} */
export async function releaseAckCommand({ repo, issue, decision, why, include = [], projectDir, gh = ghDefault, check = compatCheck, print = console.log }) {
  validate({ repo, issue, decision, why, include });
  const { body } = JSON.parse(await gh(["api", `repos/${repo}/issues/${issue}`]));
  const proposal = parseProposal(body);
  const result = await check({ projectDir, candidate: proposal.candidate });
  const answer = { decision, why, include, candidate: proposal.candidate, check: result };
  const url = (await gh(["api", "--method", "POST", `repos/${repo}/issues/${issue}/comments`, "-f", `body=${renderAnswer(answer)}`, "--jq", ".html_url"])).trim();
  print(url);
  const failed = result.suite === "fail" || result.lane === "fail";
  if (failed && result.detail) print(sanitize(result.detail));
  if (decision === "ok" && failed) print("The check failed: this ok counts as a hold until a passing answer replaces it.");
  return { url, exitCode: decision === "ok" && failed ? 1 : 0 };
}
