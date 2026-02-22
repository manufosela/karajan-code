import crypto from "node:crypto";
import { runCommand } from "../utils/process.js";

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeProjectKey(value) {
  const out = slug(value);
  if (!out) return "kj-default";
  return /[a-z]/.test(out) ? out : `kj-${out}`;
}

function digest(input) {
  return crypto.createHash("sha1").update(String(input)).digest("hex").slice(0, 12);
}

function remoteRepoName(remoteUrl) {
  const normalized = String(remoteUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) return "";
  const lastSegment = normalized.split(/[:/]/).pop() || "";
  return lastSegment.replace(/\.git$/i, "");
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

  const repo = slug(remoteRepoName(remoteUrl));
  const derived = repo ? `kj-${repo}-${digest(remoteUrl)}` : `kj-${digest(remoteUrl)}`;
  return normalizeProjectKey(derived);
}
