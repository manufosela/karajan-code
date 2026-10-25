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
import { provenanceSignature } from "../harden/phone-sign.js";
import { canonicalHarnessBody } from "../harden/sentinel-hooks.js";
import { isSealedConfig, PROVENANCE_FILE } from "../harden/supervisor-commit.js";

const HOOKS_PREFIX = ".karajan/hooks/";
const HARNESS_PREFIX = ".karajan/harness/";
// globalHooksDir es el único texto libre que se interpola en el render:
// vocabulario cerrado de ruta o la provenance no verifica NADA.
const SAFE_DIR = /^(\$HOME)?(\/[\w.@%+~-]+)+$/;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
// KJC-BUG-0311: the kj judging now, to tell a seal made by another version. Read
// lazily and never fatal (a bundled binary may not carry package.json): unknown
// means no seal counts as "older", so the strict re-render rule applies.
let kjVersionCache;
const kjVersion = () => {
  if (kjVersionCache === undefined) {
    try { kjVersionCache = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version ?? null; } catch { kjVersionCache = null; }
  }
  return kjVersionCache;
};

/**
 * @returns {{files: Set<string>, reason?: string}} rutas repo-relativas de
 * supervisor cuyo estado actual está respaldado por la provenance sellada.
 */
export function verifiedSupervisorFiles({ projectDir, trackedOnly = false }) {
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
  // KJC-TSK-0964 (ADR 0018): with a roster, an unsigned or mis-signed seal backs nothing.
  const signed = provenanceSignature({ projectDir, provenance: prov });
  if (!signed.ok) return { files: new Set(), reason: signed.reason };
  const ok = new Set();
  const unjudgeable = new Set();
  const signedAbsent = new Set();
  const current = kjVersion();
  const olderSeal = current && typeof prov?.kj_version === "string" && prov.kj_version !== current ? prov.kj_version : null;
  let vouched = false;
  let stale = false;
  // KJC-BUG-0259 (user's decision, option A): history is judged with the kj of
  // when it was committed. The harness guards are machine-local and never in the
  // repo; the review and each PR's CI verify them when the seal is made. A check
  // over the repo's history (release check) judges only what is versioned.
  const entries = (Array.isArray(prov?.files) ? prov.files : []).filter((e) => !trackedOnly || !String(e?.file).startsWith(HARNESS_PREFIX));
  // KJC-BUG-0211: desde KJC-BUG-0197 el sello cubre tambien los guardias del
  // supervisor, y aqui solo se sabian verificar los hooks. Como `complete`
  // exige que TODAS las entradas verifiquen, el sello no se podia ni commitear.
  const ROOTS = [HOOKS_PREFIX, HARNESS_PREFIX].map((p) => [p, resolve(projectDir, p)]);
  for (const entry of entries) {
    if (typeof entry?.file !== "string") continue;
    // KJC-TSK-1032: the governance config has no canonical render; the sealed
    // hash, signed by the roster where there is one, is the proof.
    if (isSealedConfig(entry.file)) {
      const abs = resolve(projectDir, entry.file);
      let st = null;
      try { st = lstatSync(abs); } catch { /* absent */ }
      if (entry.deleted === true ? st === null : st?.isFile() && sha256(readFileSync(abs)) === entry.sha256) ok.add(entry.file);
      continue;
    }
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
      // KJC-TSK-0877: with the roster's signature verified, the human signed this
      // guard's hash with the rest; that vouches for it without seeing the file.
      if (signed.required && typeof entry.sha256 === "string") { signedAbsent.add(entry.file); continue; }
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
    // KJC-BUG-0311 (#2052): sealed with another kj whose template this kj cannot
    // re-render. A phone of the roster signed these very bytes: that vouches for
    // them. Without that signature recomputation is the only proof, so it stays
    // denied (an unsigned provenance could claim any version to skip it).
    else if (olderSeal && signed.required) { ok.add(entry.file); vouched = true; }
    else if (olderSeal) stale = true;
  }
  // `complete` = ninguna entrada FALLO y alguna verifico. Exigir que todas
  // verifiquen hacia imposible sellar desde cualquier sitio que no fuera la
  // maquina que sello, porque los guardias no viajan con el repo (0212).
  const judged = (e) => ok.has(e.file) || unjudgeable.has(e.file) || signedAbsent.has(e.file);
  const complete = ok.size > 0 && entries.every((e) => typeof e?.file === "string" && judged(e));
  return {
    files: ok, complete, unjudgeable, signedAbsent, signed: signed.required,
    ...(vouched ? { vouchedOlder: olderSeal } : {}),
    ...(stale ? { reason: `sellado con kj ${olderSeal} y este kj (${current}) no puede recomputar su plantilla, y sin firma del padrón nada más lo respalda: re-séllalo con kj harden --commit` } : {}),
  };
}

/**
 * Filtra violaciones de supervisor respaldadas — {violations, lifted, note?}.
 * `note` dice lo que este sitio NO ha podido juzgar, para que un levantamiento
 * mas laxo de lo que parece no pase por silencio (KJC-BUG-0212).
 */
export function liftSealedSupervisorViolations({ projectDir, violations, trackedOnly = false }) {
  // KJC-TSK-1033: the governance config is lifted by the same seal.
  const RULES = new Set(["defaults.supervisor.write", "defaults.governance.write"]);
  if (!violations.some((v) => RULES.has(v.rule_id) && v.file)) return { violations, lifted: 0 };
  const sealed = verifiedSupervisorFiles({ projectDir, trackedOnly });
  // La violación sobre la PROPIA provenance solo se alza si la provenance
  // entera verificó — a medias no describe la verdad y sigue denegada.
  const liftable = (v) =>
    RULES.has(v.rule_id)
    && v.file
    && (sealed.files.has(v.file) || (v.file === PROVENANCE_FILE && sealed.complete === true));
  const kept = violations.filter((v) => !liftable(v));
  const unjudged = sealed.unjudgeable?.size ?? 0;
  const vouchedAbsent = sealed.signedAbsent?.size ?? 0;
  const notes = [
    ...(unjudged > 0 ? [`${unjudged} guardia(s) del sello no existen en este checkout y no se han podido comprobar aquí`] : []),
    ...(vouchedAbsent > 0 ? [`${vouchedAbsent} guardia(s) del sello no existen en este checkout y están respaldados por la firma del padrón`] : []),
    // KJC-TSK-0964: what the signature did or did not prove is said, never assumed.
    ...(sealed.signed === false ? ["proyecto sin padrón de firmantes: el sello no lleva firma verificable y su garantía es solo local"] : []),
    ...(sealed.vouchedOlder ? [`sellado con kj ${sealed.vouchedOlder}: este kj no puede recomputar su plantilla y lo respalda la firma del padrón sobre esos bytes`] : []),
    ...(kept.length === violations.length && sealed.reason ? [sealed.reason] : []),
  ];
  return {
    violations: kept,
    lifted: violations.length - kept.length,
    ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
  };
}
