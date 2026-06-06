import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { runCommand } from "./process.js";

export const QMD_DEFAULT_PATHS = ["docs", ".reviews", ".karajan/plans"];

export function projectSlug(projectDir) {
  const base = path.basename(path.resolve(projectDir));
  return base.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

export function planQmdCollections(projectDir) {
  const slug = projectSlug(projectDir);
  const result = [];
  for (const rel of QMD_DEFAULT_PATHS) {
    const abs = path.join(projectDir, rel);
    if (!existsSync(abs)) continue;
    try { if (!statSync(abs).isDirectory()) continue; } catch { continue; }
    const suffix = rel.replace(/^\./, "").replace(/[/\\]+/g, "-");
    result.push({ name: `${slug}-${suffix}`, path: abs });
  }
  return result;
}

async function listExistingCollections() {
  try {
    const res = await runCommand("qmd", ["collection", "list"]);
    if (res.exitCode !== 0) return new Set();
    const names = new Set();
    for (const line of (res.stdout || "").split("\n")) {
      const m = line.match(/^([\w.-]+)\s+\(qmd:\/\//);
      if (m) names.add(m[1]);
    }
    return names;
  } catch { return new Set(); }
}

/**
 * Register all default QMD collections for the project. Idempotent: skips
 * collections already present in `qmd collection list`. qmd's CLI only
 * accepts one path per `collection add`, so we register up to 3 sibling
 * collections (`<slug>-docs`, `<slug>-reviews`, `<slug>-karajan-plans`).
 */
export async function registerQmdCollections(projectDir, logger) {
  const planned = planQmdCollections(projectDir);
  const result = { ok: true, added: [], skipped: [], errors: [] };
  if (planned.length === 0) {
    logger.info("QMD: no indexable folders yet (docs/, .reviews/, .karajan/plans/ all missing).");
    return result;
  }
  const existing = await listExistingCollections();
  for (const { name, path: abs } of planned) {
    if (existing.has(name)) { result.skipped.push(name); continue; }
    try {
      const res = await runCommand("qmd", ["collection", "add", abs, "--name", name], { timeout: 60_000 });
      if (res.exitCode === 0) {
        result.added.push(name);
      } else {
        const err = (res.stderr || res.stdout || "").trim() || `exit code ${res.exitCode}`;
        result.errors.push(`${name}: ${err}`);
        result.ok = false;
      }
    } catch (err) {
      result.errors.push(`${name}: ${err.message || String(err)}`);
      result.ok = false;
    }
  }
  if (result.added.length) logger.info(`QMD: registered ${result.added.length} collection(s): ${result.added.join(", ")}.`);
  if (result.skipped.length) logger.info(`QMD: ${result.skipped.length} collection(s) already present, skipped.`);
  for (const err of result.errors) logger.warn(`QMD: collection registration failed — ${err}`);
  return result;
}
