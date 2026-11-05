/**
 * `kj main-guard-except <pr> --why` (KJC-TSK-1402, ADR 0037 layer 2): the maintainer's exception for
 * a merge that skips its required checks on purpose. A human act (ADR 0018): refused to an agent
 * session, then the phone signs the repo, the PR, its current head and the reason, and the signed
 * exception is posted as a comment of the PR, where main-guard verifies it against the repo's roster.
 * The phone's signature is the exception: with no phone enrolled there is none to post.
 */
import { execFileSync } from "node:child_process";

import { exceptionFiles, renderException } from "../guards/main-guard-exception.js";
import { signAct } from "../harden/act-sign.js";
import { humanAct } from "../harden/human-act.js";

const ghDefault = async (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** ADR 0018: refused to an agent session, then signed by the phone over the exception's fields. */
async function exceptAct(files, { projectDir, kjVersion, summary }) {
  humanAct("main-guard-except");
  const { signature } = await signAct("main-guard-except", {
    projectDir, kjVersion, files, changes: [{ file: files[0].file, status: "new", summary, diff: summary, truncated: false }],
  });
  return signature;
}

/** @returns {Promise<{pr: number, head: string, url: string}>} */
export async function mainGuardExceptCommand({ repo, pr: raw, why, projectDir = process.cwd(), kjVersion = "unknown", gh = ghDefault, act = exceptAct, print = console.log }) {
  const reason = String(why ?? "").trim();
  if (!reason) throw new Error("main-guard-except: give the reason with --why: it is signed and shown in main-guard's report");
  if (!/^\d+$/.test(String(raw))) throw new Error(`main-guard-except: "${raw}" is not a PR number`);
  const pr = Number(raw);
  const head = JSON.parse(await gh(["api", `repos/${repo}/pulls/${pr}`])).head.sha;
  const files = exceptionFiles({ repo, pr, head, why: reason });
  const signature = await act(files, { projectDir, kjVersion, summary: `exception for ${repo}#${pr} at ${head.slice(0, 7)}: ${reason}` });
  if (!signature) throw new Error("main-guard-except: the exception needs the phone's signature, and no phone signed it: enroll one with kj identity enroll-phone");
  const body = renderException({ repo, pr, head, why: reason, signature });
  const url = String(await gh(["api", "--method", "POST", `repos/${repo}/issues/${pr}/comments`, "-f", `body=${body}`, "--jq", ".html_url"])).trim();
  print(`✓ signed exception for #${pr} at ${head.slice(0, 7)} posted: ${url}`);
  return { pr, head, url };
}
