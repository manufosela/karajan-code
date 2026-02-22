import crypto from "node:crypto";
import path from "node:path";

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

export async function resolveSonarProjectKey(config, options = {}) {
  const explicit = String(
    options.projectKey || process.env.KJ_SONAR_PROJECT_KEY || config?.sonarqube?.project_key || ""
  ).trim();
  if (explicit) {
    return normalizeProjectKey(explicit);
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const repo = slug(path.basename(cwd)) || "repo";
  return normalizeProjectKey(`kj-${repo}-${digest(cwd)}`);
}
