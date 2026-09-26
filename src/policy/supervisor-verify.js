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
import { canonicalHarnessBody } from "../harden/sentinel-hooks.js";
import { PROVENANCE_FILE } from "../harden/supervisor-commit.js";

const HOOKS_PREFIX = ".karajan/hooks/";
const HARNESS_PREFIX = ".karajan/harness/";
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
  const unjudgeable = new Set();
  const entries = Array.isArray(prov?.files) ? prov.files : [];
  // KJC-BUG-0211: desde KJC-BUG-0197 el sello cubre tambien los guardias del
  // supervisor, y aqui solo se sabian verificar los hooks. Como `complete`
  // exige que TODAS las entradas verifiquen, el sello no se podia ni commitear.
  const ROOTS = [HOOKS_PREFIX, HARNESS_PREFIX].map((p) => [p, resolve(projectDir, p)]);
  for (const entry of entries) {
    if (typeof entry?.file !== "string") continue;
    const kind = ROOTS.find(([prefix]) => entry.file.startsWith(prefix));
    if (!kind) continue;
    const [prefix, root] = kind;
    // Contención por resolución, no por prefijo textual (catch de codex).
    const abs = resolve(projectDir, entry.file);
    if (!abs.startsWith(root + sep)) continue;
    let st = null;
    try { st = lstatSync(abs); } catch { /* no hay objeto en la ruta */ }
    if (entry.deleted === true) {
      if (st === null) ok.add(entry.file);
      continue;
    }
    // KJC-BUG-0212: los guardias estan en .gitignore, viven solo en la maquina
    // que ejecuta kj harden. Que no esten AQUI no es que no verifiquen: es que
    // este checkout (CI, otro clon) no puede juzgarlos. Un hook ausente si
    // significa algo, porque los hooks si viajan con el repo.
    // Pero "no esta aqui" no vale como cheque en blanco: el hash declarado
    // tiene que ser el de un guardia que kj CONOCE, o una procedencia forjada
    // colaria entradas ausentes con cualquier hash (catch de la review).
    if (prefix === HARNESS_PREFIX && st === null) {
      const body = canonicalHarnessBody(entry.file.slice(prefix.length));
      if (body != null && typeof entry.sha256 === "string" && sha256(Buffer.from(body, "utf8")) === entry.sha256) unjudgeable.add(entry.file);
      continue;
    }
    if (typeof entry.sha256 !== "string" || !st?.isFile()) continue;
    if (sha256(readFileSync(abs)) !== entry.sha256) continue;
    // No se confia en el hash sellado: se recomputa lo que kj escribiria.
    let canonical;
    try {
      const name = entry.file.slice(prefix.length);
      canonical = prefix === HOOKS_PREFIX ? renderCanonicalHook(name, gen) : canonicalHarnessBody(name);
    } catch {
      continue;
    }
    if (canonical != null && sha256(Buffer.from(canonical, "utf8")) === entry.sha256) ok.add(entry.file);
  }
  // `complete` = ninguna entrada FALLO y alguna verifico. Exigir que todas
  // verifiquen hacia imposible sellar desde cualquier sitio que no fuera la
  // maquina que sello, porque los guardias no viajan con el repo (0212).
  const judged = (e) => ok.has(e.file) || unjudgeable.has(e.file);
  const complete = ok.size > 0 && entries.every((e) => typeof e?.file === "string" && judged(e));
  return { files: ok, complete, unjudgeable };
}

/**
 * Filtra violaciones de supervisor respaldadas — {violations, lifted, note?}.
 * `note` dice lo que este sitio NO ha podido juzgar, para que un levantamiento
 * mas laxo de lo que parece no pase por silencio (KJC-BUG-0212).
 */
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
  const unjudged = sealed.unjudgeable?.size ?? 0;
  return {
    violations: kept,
    lifted: violations.length - kept.length,
    ...(unjudged > 0 ? { note: `${unjudged} guardia(s) del sello no existen en este checkout y no se han podido comprobar aquí` } : {}),
  };
}
