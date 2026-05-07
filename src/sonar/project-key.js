import crypto from "node:crypto";
import { runCommand } from "../utils/process.js";

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9._:-]+/g, "-")
    .replaceAll(/-{2,}/g, "-")
    .replaceAll(/(^-+)|(-+$)/g, "");
}

function normalizeProjectKey(value) {
  const out = slug(value);
  if (!out) return "kj-default";
  return /[a-z]/.test(out) ? out : `kj-${out}`;
}

function digest(input) {
  return crypto.createHash("sha1").update(String(input)).digest("hex").slice(0, 12);
}

function parseScpLikeRemote(remoteUrl) {
  // Example: git@github.com:owner/repo.git
  const match = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(String(remoteUrl || "").trim());
  if (!match) return null;
  return { host: match[1], path: match[2] };
}

function parseUrlLikeRemote(remoteUrl) {
  try {
    const parsed = new URL(String(remoteUrl || "").trim());
    return { host: parsed.hostname, path: parsed.pathname.replace(/^\/+/, "") };
  } catch { /* not a valid URL */
    return null;
  }
}

function canonicalRepoId(remoteUrl) {
  const raw = String(remoteUrl || "").trim();
  if (!raw) return null;

  const parsed = raw.includes("://") ? parseUrlLikeRemote(raw) : (parseScpLikeRemote(raw) || parseUrlLikeRemote(raw));
  if (!parsed) return null;

  const host = String(parsed.host || "").trim().toLowerCase();
  const cleanPath = String(parsed.path || "")
    .trim()
    .replaceAll(/(^\/+)|(\/+$)/g, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
  const segments = cleanPath.split("/").filter(Boolean);
  if (!host || segments.length < 2) return null;

  // Keep full repository path (owner/subgroups/repo) to avoid collisions in nested groups.
  return `${host}/${segments.join("/")}`;
}

export async function resolveSonarProjectKey(config, options = {}) {
  const explicit = String(
    options.projectKey || process.env.KJ_SONAR_PROJECT_KEY || config?.sonarqube?.project_key || ""
  ).trim();
  if (explicit) {
    return normalizeProjectKey(explicit);
  }

  const remote = await runCommand("git", ["config", "--get", "remote.origin.url"]);
  const remoteUrl = String(remote.stdout || "").trim();
  if (remote.exitCode !== 0 || !remoteUrl) {
    throw new Error(
      "Missing git remote.origin.url. Configure remote origin or set sonarqube.project_key explicitly."
    );
  }

  const repoId = canonicalRepoId(remoteUrl);
  if (!repoId) {
    throw new Error(
      "Unable to parse git remote.origin.url. Use a valid SSH/HTTPS remote or set sonarqube.project_key explicitly."
    );
  }

  const repo = slug(repoId.split("/").pop());
  return normalizeProjectKey(`kj-${repo}-${digest(repoId)}`);
}

/**
 * Non-throwing predicate: can a Sonar project key be resolved for `config`?
 *
 * Used by callers (audit collector, run-loop SonarStage) that want to skip
 * the Sonar work cleanly instead of letting `resolveSonarProjectKey` throw
 * "Missing git remote.origin.url" deep inside the scanner. The scanner's
 * thrown error is fine for an explicit `kj sonar` call (the user asked
 * for it), but for implicit pipeline gates it produces a noisy "Sonar
 * scan failed" loop in fresh /tmp/... repos.
 *
 * Returns true when EITHER:
 *   - an explicit `project_key` is set (env var, config, or per-call option),
 *   - OR `git config --get remote.origin.url` succeeds with a non-empty value.
 *
 * Side-effect-free apart from the git probe.
 *
 * @param {object} config
 * @param {object} [options]
 * @param {string} [options.projectKey]
 * @returns {Promise<boolean>}
 */
export async function canResolveSonarProjectKey(config, options = {}) {
  const explicit = String(
    options.projectKey || process.env.KJ_SONAR_PROJECT_KEY || config?.sonarqube?.project_key || ""
  ).trim();
  if (explicit) return true;
  // try/catch (instead of `.catch(...)`) tolerates two legitimate test
  // realities: a runCommand mock that returns undefined, and a real
  // promise rejection from a missing git binary. Either way we treat
  // it as "no remote available" and let the caller skip Sonar cleanly.
  let remote;
  try { remote = await runCommand("git", ["config", "--get", "remote.origin.url"]); }
  catch { return false; }
  if (!remote) return false;
  return remote.exitCode === 0 && String(remote.stdout || "").trim().length > 0;
}
