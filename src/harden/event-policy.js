/**
 * KJC-BUG-0532: from 2026-12-02 GitHub blocks pull_request_target in PUBLIC repos
 * that have no Actions event policy allowing it, and kj-policy.yml runs on it on
 * purpose (the judge comes from the base branch). Creating the policy is an admin
 * act, like branch protection: kj reads what is there and says what to do.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { runCommand } from "../utils/process.js";
import { assertGhIdentity } from "../hu/gh-identity.js";
import { GITHUB_REMOTE } from "./branch-protection.js";

const EVENT = "pull_request_target";
function triggers(on) {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on ?? {});
}

function workflowEvents(file) {
  try { return triggers(parseYaml(fs.readFileSync(file, "utf8"))?.on); } catch { return []; }
}

/** The union of the `on` events of every workflow in the project, sorted. */
function projectEvents(projectDir) {
  const dir = path.join(projectDir, ".github", "workflows");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  return [...new Set(files.flatMap((f) => workflowEvents(path.join(dir, f))))].toSorted();
}

async function ghJson(run, endpoint) {
  const res = await run("gh", ["api", endpoint]);
  if (res.exitCode !== 0) throw new Error((res.stderr || res.stdout || "gh failed").trim());
  return JSON.parse(res.stdout || "{}");
}

const allows = (policies) => (policies ?? []).some((p) => p?.enforcement === "active"
  && (p.rules ?? []).some((r) => r?.type === "restrict_action_events" && r.parameters?.allowed_events?.includes(EVENT)));

function warnInstructions({ logger, owner, repo, events, reason }) {
  const head = reason ? `could not read the Actions event policies (${reason}). ` : "";
  logger.warn?.(`  ⚠ event policy: ${head}GitHub blocks ${EVENT} in public repos from 2026-12-02 unless an Actions event policy allows it, and kj-policy.yml needs it.`);
  logger.warn?.(`      An admin creates the policy (a "Restrict events" rule) in https://github.com/${owner}/${repo}/settings/actions (Settings › Actions › Policies),`);
  logger.warn?.(`      allowing ${events.join(", ")}: that rule permits only the events it lists, so every event the workflows use must be in it.`);
}

/** kj harden: on a public GitHub repo, whether pull_request_target is allowed by an event policy. Never mutates. */
export async function adviseEventPolicy({ projectDir, logger, run = runCommand, identity = assertGhIdentity }) {
  const policyFile = path.join(projectDir, ".github", "workflows", "kj-policy.yml");
  if (!fs.existsSync(policyFile) || !workflowEvents(policyFile).includes(EVENT)) return null;
  const remote = await run("git", ["-C", projectDir, "remote", "get-url", "origin"]).catch(() => null);
  const match = remote?.exitCode === 0 ? GITHUB_REMOTE.exec(remote.stdout.trim()) : null;
  if (!match) return null;
  const [, owner, repo] = match;
  const events = projectEvents(projectDir);
  try {
    identity({ projectDir });
    if ((await ghJson(run, `repos/${owner}/${repo}`)).visibility !== "public") return null;
    const { policies } = await ghJson(run, `repos/${owner}/${repo}/actions/policies`);
    if (allows(policies)) {
      logger.info?.(`  • event policy: ${EVENT} is allowed`);
      return { status: "ok", events };
    }
    warnInstructions({ logger, owner, repo, events });
    return { status: "missing", events };
  } catch (err) {
    warnInstructions({ logger, owner, repo, events, reason: err.message });
    return { status: "unverified", events };
  }
}
