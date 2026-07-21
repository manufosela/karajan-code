/**
 * `kj report-issue` (AB-F 2/2, KJC-TSK-0655) — the brain files kj
 * frictions to the public repo. Default output is a sanitized preview
 * plus a prefilled new-issue URL: publishing stays a human decision.
 * `--publish` uses the gh CLI; the playbook orders the brain to confirm
 * with its user before passing it.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runCommand } from "../utils/process.js";
import { composeIssue, findSimilarIssues, newIssueUrl, REPO } from "../environment/issue-report.js";

function kjVersion() {
  try {
    const pkg = resolve(fileURLToPath(import.meta.url), "../../../package.json");
    return JSON.parse(readFileSync(pkg, "utf8")).version;
  } catch { return "unknown"; }
}

export async function reportIssueCommand({ logger: _logger = null, flags = {}, deps = {} }) {
  if (!flags.title || !flags.title.trim()) {
    throw new Error("kj report-issue requires --title \"<one-line summary>\"");
  }
  const { fetchFn = globalThis.fetch, runCmd = runCommand } = deps;

  const { title, body } = composeIssue({
    title: flags.title,
    description: flags.description || "",
    command: flags.command || "",
    error: flags.error || "",
    env: { kjVersion: kjVersion(), nodeVersion: process.version, platform: `${os.platform()}-${os.arch()}` },
  });
  const url = newIssueUrl({ title, body });

  const similar = await findSimilarIssues(title, { fetchFn });
  if (similar.length > 0 && !flags.force) {
    const res = { published: false, title, body, similar, url };
    if (flags.json) console.log(JSON.stringify(res));
    else {
      console.log(`✗ ${similar.length} similar open issue(s) — comment there instead of duplicating (or re-run with --force):`);
      for (const s of similar) console.log(`  #${s.number} ${s.title}\n     ${s.html_url}`);
    }
    process.exitCode = 1;
    return res;
  }

  if (flags.publish) {
    try {
      const gh = await runCmd("gh", ["issue", "create", "--repo", REPO, "--title", title, "--body", body]);
      if (gh.exitCode !== 0) throw new Error(gh.stderr?.trim() || `gh exited ${gh.exitCode}`);
      const issueUrl = gh.stdout.trim().split("\n").pop();
      const res = { published: true, title, url: issueUrl, similar };
      if (flags.json) console.log(JSON.stringify(res));
      else console.log(`✓ issue published: ${issueUrl}`);
      process.exitCode = 0;
      return res;
    } catch (err) {
      const res = { published: false, title, body, similar, url, error: err.message };
      if (flags.json) console.log(JSON.stringify(res));
      else console.log(`✗ could not publish via gh (${err.message}) — open it manually:\n${url}`);
      process.exitCode = 1;
      return res;
    }
  }

  const res = { published: false, title, body, similar, url };
  if (flags.json) console.log(JSON.stringify(res));
  else {
    console.log(`--- issue preview (sanitized) ---\n# ${title}\n\n${body}\n---`);
    console.log(`Open (and edit) it here:\n${url}`);
    console.log("Or publish directly with --publish (requires gh; confirm with your user first).");
  }
  process.exitCode = 0;
  return res;
}
