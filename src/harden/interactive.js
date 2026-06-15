/**
 * interactive — `kj harden --interactive` (KJC-TSK-0567, épica KJC-PCS-0060).
 *
 * Walks the advisory comparison (Advisory A/B) and asks, artifact by artifact,
 * whether to apply the kj standard — with a safe default of leaving the user's
 * own config untouched. Only the pieces the user says yes to are written:
 *
 *   MISSING                  → add it?      (default yes — same as seed-if-absent)
 *   KJ_MANAGED outdated      → update it?   (default yes)
 *   USER_OWNED w/ gaps       → adopt kj's?  (default NO — keep yours)
 *
 * The full merge (user's config + kj rules) is out of scope here (v2): adopt
 * replaces the file with kj's standard. `ask` is injected so the flow is
 * testable without a TTY; the CLI passes a readline-backed confirm.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { upsertManagedBlock } from "../utils/managed-markers.js";
import { compareHarden } from "./advisory.js";
import { CONFIGS_BY_LANGUAGE, UNIVERSAL_CONFIGS } from "./config-templates.js";

const BLOCK_VERSION = 1; // mirrors config-engine.js

// Artifact id (blockId, or "prettier" for the marker-less JSON) → its template.
const TEMPLATE_BY_ID = new Map();
for (const cfg of [...UNIVERSAL_CONFIGS, ...Object.values(CONFIGS_BY_LANGUAGE).flat()]) {
  TEMPLATE_BY_ID.set(cfg.blockId ?? "prettier", cfg);
}

/** What to ask (and do) for one classified artifact; null = nothing to offer. */
export function decideAction(a) {
  if (a.recommendation === "install") return { action: "add", defaultYes: true, prompt: `Add ${a.file}? (${a.rationale})` };
  if (a.recommendation === "update") return { action: "update", defaultYes: true, prompt: `Update ${a.file} to kj v${a.currentVersion}?` };
  if (a.recommendation === "review") {
    return { action: "adopt", defaultYes: false, prompt: `Adopt kj's ${a.file}? Replaces yours, adds ${a.improvements.length} improvement(s). Default keeps yours.` };
  }
  return null; // keep / up-to-date — nothing to ask
}

/** Write an artifact's kj body. `overwrite` discards the user's file (adopt). */
function applyArtifact(projectDir, dir, cfg, { overwrite }) {
  const target = join(projectDir, dir === "." ? "" : dir, cfg.file);
  mkdirSync(dirname(target), { recursive: true });
  if (cfg.json) {
    writeFileSync(target, `${cfg.body}\n`);
    return;
  }
  const source = !overwrite && existsSync(target) ? readFileSync(target, "utf8") : "";
  const { content } = upsertManagedBlock({ source, blockId: cfg.blockId, version: BLOCK_VERSION, body: cfg.body, style: cfg.style });
  writeFileSync(target, content);
}

/**
 * Run the interactive adoption flow. `ask(prompt, defaultYes) → Promise<bool>`.
 * Returns the list of applied artifacts. Writes nothing the user declines.
 */
export async function interactiveHarden({ projectDir = process.cwd(), profile = "standard", only = [], exclude = [], ask, logger = console } = {}) {
  const { artifacts } = compareHarden({ projectDir, profile, only, exclude });
  const applied = [];
  for (const a of artifacts) {
    const plan = decideAction(a);
    if (!plan) continue;
    const yes = await ask(plan.prompt, plan.defaultYes);
    if (!yes) continue;
    const cfg = TEMPLATE_BY_ID.get(a.id);
    if (!cfg) continue;
    applyArtifact(projectDir, a.dir, cfg, { overwrite: plan.action === "adopt" });
    const where = a.dir === "." ? a.file : join(a.dir, a.file);
    applied.push({ file: where, action: plan.action });
    logger.info?.(`  ✓ ${plan.action} ${where}`);
  }
  if (applied.length === 0) logger.info?.("kj harden — nothing applied (kept everything as-is).");
  return { ok: true, interactive: true, applied };
}
