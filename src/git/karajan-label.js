/**
 * KJC-TSK-1123 (#2315): every PR Karajan governs carries the «Karajan» label, so
 * a team can measure how much of its change goes through the governor. It means
 * "went through Karajan", never "written by an AI": Karajan governs AIs, and the
 * PR may be a person's work it reviewed. The signal lives only in the PR's
 * metadata, never in commits or the PR body. Labelling never costs the PR: a
 * failure is logged and the work goes on. KJC-BUG-0461: since 5.0 (no kj run opening PRs)
 * kj review --publish-pr adds it, the step of the method that runs on every PR.
 */
import { runCommand } from "../utils/process.js";

export const KARAJAN_LABEL = "Karajan";
const LABEL_COLOR = "1f6feb";
const LABEL_DESCRIPTION = "Went through Karajan (governed and reviewed); not a claim that an AI wrote it";

/** The PR a URL or a bare number names: { repo: "owner/repo" or null for the repo gh runs in, number }. */
function prOf(ref) {
  const url = /^https:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(String(ref ?? ""));
  if (url) return { repo: url[1], number: url[2] };
  return /^\d+$/.test(String(ref ?? "")) ? { repo: null, number: String(ref) } : null;
}

/**
 * Add the label to the PR, creating it first when the repo lacks it.
 * @param {{url: string|number}} args a PR URL, or its number in the repo gh runs in
 * @returns {Promise<boolean>} true when the PR carries the label.
 */
export async function labelKarajanPr({ url, cwd = null, run = runCommand, warn = (msg) => process.stderr.write(`${msg}\n`) }) {
  const opts = cwd ? { cwd } : {};
  const pr = prOf(url);
  if (!pr) {
    warn(`kj: could not add the Karajan label to ${url}: not a pull request URL or number`);
    return false;
  }
  try {
    // Fails when the label exists; the call below says whether the PR got it.
    await run("gh", ["label", "create", KARAJAN_LABEL, "--color", LABEL_COLOR, "--description", LABEL_DESCRIPTION, ...(pr.repo ? ["--repo", pr.repo] : [])], opts);
    // KJC-BUG-0462: REST. `gh pr edit --add-label` asks GraphQL for the PR's classic project
    // cards and fails since GitHub sunset Projects (classic), so no PR got the label.
    const res = await run("gh", ["api", "-X", "POST", `repos/${pr.repo ?? "{owner}/{repo}"}/issues/${pr.number}/labels`, "-f", `labels[]=${KARAJAN_LABEL}`], opts);
    if (res.exitCode === 0) return true;
    warn(`kj: could not add the Karajan label to ${url}: ${(res.stderr || res.stdout || "").trim()}`);
  } catch (err) {
    warn(`kj: could not add the Karajan label to ${url}: ${err.message}`);
  }
  return false;
}
