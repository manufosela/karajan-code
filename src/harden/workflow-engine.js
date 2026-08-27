/**
 * workflow-engine — seeds CI quality workflows for `kj harden` (KJC-TSK-0557).
 *
 * Seed-if-absent into `.github/workflows/`: a workflow the user already wrote
 * (no kj:managed marker) is left untouched and reported "skipped". kj-managed
 * workflows refresh in place. Markers ride in YAML `#` comments.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { parse as parseYaml } from "yaml";
import { upsertManagedBlock } from "../utils/managed-markers.js";
import { extraWorkflowsFor, mutationWorkflowFor, qualityWorkflowFor, policyWorkflowFor, stewardWorkflowFor, WORKFLOWS } from "./workflow-templates.js";

// La versión del kj que corre harden — es la que se pinea en el fallback
// npx del workflow de policy (jamás @latest en CI). Lectura LAZY: en el
// bundle SEA no hay package.json junto al módulo y una lectura eager a
// nivel de módulo tumbaba el binario entero al cargar (ENOENT /package.json).
let _ownPkg;
function ownPkg() {
  if (_ownPkg === undefined) {
    try {
      _ownPkg = JSON.parse(
        readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8"),
      );
    } catch {
      _ownPkg = null;
    }
  }
  return _ownPkg;
}

const BLOCK_VERSION = 1;
const WORKFLOWS_DIR = join(".github", "workflows");

/** A package.json that ships code (not private, has bin or main) ⇒ publishable. */
export function isPublishableNpm(projectDir) {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.private !== true && Boolean(pkg.bin || pkg.main);
  } catch {
    return false;
  }
}

/** Lockfile-detected package manager (KJC-BUG-0131): npm ci kills pnpm/yarn CI. */
export function detectPackageManager(projectDir) {
  if (existsSync(join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectDir, "yarn.lock"))) return "yarn";
  return "npm";
}

// KJC-BUG-0137: the JS quality workflow only carries a lint step when the
// project HAS a lint script — and then it enforces (no --if-present).
function hasLintScript(projectDir) {
  try {
    return Boolean(JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8")).scripts?.lint);
  } catch {
    return false;
  }
}

export function installWorkflows({
  projectDir = process.cwd(),
  language = null,
  profile = "standard",
  mutation = false,
  dryRun = false,
  kjVersion = null,
} = {}) {
  const dir = join(projectDir, WORKFLOWS_DIR);
  const pm = detectPackageManager(projectDir);
  const quality = qualityWorkflowFor(language, pm, hasLintScript(projectDir));
  const extras = extraWorkflowsFor({ profile, publishable: isPublishableNpm(projectDir), pm });
  const mut = mutation ? mutationWorkflowFor(language, pm) : null;
  // PL-C: el tier C solo existe donde el proyecto DECLARA policy. Versión a
  // pinear: la plumbeada por el CLI (SEA) o la propia; "latest" es último
  // recurso inalcanzable en los caminos reales.
  const pinned = kjVersion ?? ownPkg()?.version ?? "latest";
  const policy = existsSync(join(projectDir, ".karajan", "policy.yml"))
    ? { file: "kj-policy.yml", blockId: "wf-policy", body: policyWorkflowFor(pinned, ownPkg()?.name ?? "karajan-code") }
    : null;
  // STW-E (KJC-TSK-0793): the scheduled sweep is OPT-IN — the project says
  // steward.action: true in its config; nothing is imposed by default.
  let stewardOn = false;
  try { stewardOn = parseYaml(readFileSync(join(projectDir, ".karajan", "kj.config.yml"), "utf8"))?.steward?.action === true; } catch { /* no config — no action */ }
  const steward = stewardOn ? { file: "kj-steward.yml", blockId: "wf-steward", body: stewardWorkflowFor(pinned, ownPkg()?.name ?? "karajan-code") } : null;
  const all = [...WORKFLOWS, ...(quality ? [quality] : []), ...extras, ...(mut ? [mut] : []), ...(policy ? [policy] : []), ...(steward ? [steward] : [])];
  const results = [];
  for (const wf of all) {
    const target = join(dir, wf.file);
    const label = join(WORKFLOWS_DIR, wf.file);
    const exists = existsSync(target);
    const source = exists ? readFileSync(target, "utf8") : "";
    if (exists && !source.includes(`kj:managed:${wf.blockId}`)) {
      results.push({ file: label, action: "skipped" });
      continue;
    }
    const { content, action } = upsertManagedBlock({
      source,
      blockId: wf.blockId,
      version: BLOCK_VERSION,
      body: wf.body,
      style: "hash",
    });
    if (!dryRun && action !== "unchanged") {
      mkdirSync(dir, { recursive: true });
      // Newline final SIEMPRE: prettier (y POSIX) lo exigen y el bloque
      // gestionado no lo garantiza — sin esto, el format-check del propio
      // pre-commit rechaza el fichero recién generado.
      writeFileSync(target, content.endsWith("\n") ? content : `${content}\n`);
    }
    results.push({ file: label, action });
  }
  return { dryRun, workflows: results };
}
