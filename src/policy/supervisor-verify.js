/**
 * KJC-BUG-0161 / ADR 0009, pieza 3 — exención ESTRUCTURAL del supervisor:
 * un fichero de .karajan/hooks solo deja de ser violación si su contenido
 * coincide (sha256) con la provenance sellada Y con el render canónico
 * recomputado. No confía: recomputa. Una coma manual sigue denegada.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import { renderCanonicalHook } from "../harden/harden-engine.js";
import { PROVENANCE_FILE } from "../harden/supervisor-commit.js";

const HOOKS_PREFIX = ".karajan/hooks/";
// globalHooksDir es el único texto libre que se interpola en el render:
// vocabulario cerrado de ruta o la provenance no verifica NADA.
const SAFE_DIR = /^(\$HOME)?(\/[\w.@%+~-]+)+$/;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * @returns {{files: Set<string>, reason?: string}} rutas repo-relativas de
 * supervisor cuyo estado actual está respaldado por la provenance sellada.
 */
export function verifiedSupervisorFiles({ projectDir }) {
  let prov;
  try {
    prov = JSON.parse(readFileSync(resolve(projectDir, PROVENANCE_FILE), "utf8"));
  } catch {
    return { files: new Set(), reason: "sin provenance" };
  }
  const gen = prov?.generation ?? {};
  if (gen.globalHooksDir != null && !SAFE_DIR.test(gen.globalHooksDir)) {
    return { files: new Set(), reason: "globalHooksDir no verificable en la provenance" };
  }
  const ok = new Set();
  const entries = Array.isArray(prov?.files) ? prov.files : [];
  const hooksRoot = resolve(projectDir, HOOKS_PREFIX);
  for (const entry of entries) {
    if (typeof entry?.file !== "string" || !entry.file.startsWith(HOOKS_PREFIX)) continue;
    // Contención por resolución, no por prefijo textual (catch de codex).
    const abs = resolve(projectDir, entry.file);
    if (!abs.startsWith(hooksRoot + sep)) continue;
    let st = null;
    try { st = lstatSync(abs); } catch { /* no hay objeto en la ruta */ }
    if (entry.deleted === true) {
      if (st === null) ok.add(entry.file);
      continue;
    }
    if (typeof entry.sha256 !== "string" || !st?.isFile()) continue;
    if (sha256(readFileSync(abs)) !== entry.sha256) continue;
    let canonical;
    try {
      canonical = renderCanonicalHook(entry.file.slice(HOOKS_PREFIX.length), gen);
    } catch {
      continue;
    }
    if (sha256(Buffer.from(canonical, "utf8")) === entry.sha256) ok.add(entry.file);
  }
  // `complete` = CADA entrada verificó: solo entonces la provenance se
  // describe con honestidad y su propio diff puede alzarse.
  const complete = entries.length > 0 && entries.every((e) => typeof e?.file === "string" && ok.has(e.file));
  return { files: ok, complete };
}

/** Filtra violaciones de supervisor respaldadas — {violations, lifted}. */
export function liftSealedSupervisorViolations({ projectDir, violations }) {
  const RULE = "defaults.supervisor.write";
  if (!violations.some((v) => v.rule_id === RULE && v.file)) return { violations, lifted: 0 };
  const sealed = verifiedSupervisorFiles({ projectDir });
  // La violación sobre la PROPIA provenance solo se alza si la provenance
  // entera verificó — a medias no describe la verdad y sigue denegada.
  const liftable = (v) =>
    v.rule_id === RULE
    && v.file
    && (sealed.files.has(v.file) || (v.file === PROVENANCE_FILE && sealed.complete === true));
  const kept = violations.filter((v) => !liftable(v));
  return { violations: kept, lifted: violations.length - kept.length };
}
