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
