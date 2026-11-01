/**
 * Agent token check (KJC-TSK-1268, ADR 0037).
 *
 * The agent works with whatever token `gh` uses. ADR 0037 asks for a fine-grained token without
 * Administration or Deployments, so the agent can neither change branch protection nor approve
 * a protected environment such as npm-publish. Two probes that change nothing tell:
 * - reading the default branch's protection needs Administration;
 * - reviewing pending deployments of a run that does not exist is refused (403) without
 *   Deployments write, and answers 404/422 with it.
 */

import { execFileSync } from "node:child_process";

import { STRATEGY } from "./types.js";

const FIX = "Give the agent a fine-grained token with no Administration, Environments, Secrets, Variables or Deployments "
  + "(github.com/settings/personal-access-tokens/new), load it with `gh auth login --with-token`, revoke the old one "
  + "and do admin acts in the browser (ADR 0037)";

const OWNER_REPO = /^\/?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

/** owner/repo of a GitHub remote, or null: exact host github.com, or an ssh alias github.com-<name>. */
export function parseGithubRepo(url) {
  const text = String(url ?? "").trim();
  const scp = /^[\w.-]+@github\.com(?:-[\w.-]+)?:(.+)$/.exec(text);
  let path = scp?.[1];
  if (!path) {
    try {
      const parsed = new URL(text);
      if (!["https:", "ssh:"].includes(parsed.protocol) || !/^github\.com(?:-[\w.-]+)?$/.test(parsed.hostname)) return null;
      if (parsed.protocol === "https:" && parsed.hostname !== "github.com") return null;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  const match = OWNER_REPO.exec(path);
  return match ? `${match[1]}/${match[2]}` : null;
}

function defaultOriginUrl(projectDir) {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], { cwd: projectDir, encoding: "utf8", timeout: 10_000 });
  } catch {
    return null;
  }
}

/** `gh api` as data: the HTTP status gh reports and the JSON body, success or not. */
async function defaultGh(args) {
  try {
    return { status: 200, body: JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8", timeout: 20_000, stdio: "pipe" }) || "{}") };
  } catch (err) {
    const status = Number(/\(HTTP (\d{3})\)/.exec(String(err.stderr ?? ""))?.[1]);
    if (!status) throw err;
    let body = {};
    try { body = JSON.parse(String(err.stdout ?? "") || "{}"); } catch { /* gh printed no JSON body */ }
    return { status, body };
  }
}

/** true/false for the answers each probe expects; anything else (401, 5xx...) cannot be read. */
function hasAdmin({ status, body }) {
  if (status === 200) return true;
  if (status === 404) return /not protected/i.test(body?.message ?? "");
  if (status === 403) return false;
  throw new Error(`branch protection probe answered HTTP ${status}`);
}

function canApprove({ status }) {
  if (status === 404 || status === 422) return true;
  if (status === 403) return false;
  throw new Error(`deployment review probe answered HTTP ${status}`);
}

async function defaultBranchOf(gh, repo) {
  const { status, body } = await gh([`repos/${repo}`]);
  if (status !== 200 || !body?.default_branch) throw new Error(`reading ${repo} answered HTTP ${status}`);
  return body.default_branch;
}

export function createAgentTokenCheck({ projectDir = process.cwd(), originUrl = () => defaultOriginUrl(projectDir), gh = defaultGh } = {}) {
  return {
    name: "agent-token",
    label: "agent's GitHub token (no admin power)",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const repo = parseGithubRepo(originUrl());
      if (!repo) return { ok: true, severity: "info", detail: "no GitHub origin: nothing to check" };
      try {
        const branch = await defaultBranchOf(gh, repo);
        const powers = [];
        if (hasAdmin(await gh([`repos/${repo}/branches/${encodeURIComponent(branch)}/protection`]))) {
          powers.push("it holds the Administration permission (it reads branch protection; ADR 0037 allows it at no level, since write changes protection and settings)");
        }
        const probe = ["-X", "POST", `repos/${repo}/actions/runs/1/pending_deployments`, "-F", "environment_ids[]=0", "-f", "state=rejected", "-f", "comment=kj doctor probe"];
        if (canApprove(await gh(probe))) powers.push("it can approve protected environments (Deployments write)");
        if (powers.length === 0) return { ok: true, severity: "info", detail: `the token gh uses has no admin power over ${repo}` };
        return { ok: false, severity: "warn", detail: `the token gh uses on ${repo}: ${powers.join("; ")}`, fix: FIX };
      } catch (err) {
        const reason = `${err?.code ?? ""} ${err?.stderr ?? ""} ${err?.message ?? err}`;
        // No gh, or gh with no token: the agent holds no GitHub power to check.
        if (/ENOENT|gh auth login|not logged in/i.test(reason)) return { ok: true, severity: "info", detail: "gh has no GitHub token here: nothing to check" };
        return { ok: false, severity: "warn", detail: `could not check the token gh uses: ${String(err?.message || err).split("\n")[0]}`, fix: FIX };
      }
    },
  };
}

export function getAgentTokenChecks({ projectDir } = {}) {
  return [createAgentTokenCheck({ projectDir })];
}
