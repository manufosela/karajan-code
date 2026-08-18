/**
 * Registro de Decisiones de chokepoint (GOV-C, KJC-TSK-0747) — append-only
 * y hash-encadenado: cada entrada lleva `prev` = sha256 de la LÍNEA
 * anterior, así que editar o borrar una entrada rompe la cadena de forma
 * VERIFICABLE sin más infraestructura que el propio fichero. Se registran
 * deny, excepciones y el allow del chokepoint de commit — nunca los allow
 * de tool call. El kernel no hace I/O: append/lastLine son del adaptador.
 */
import { createHash } from "node:crypto";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** @returns {object} the recorded entry (with ts + prev sealed). */
export function recordDecision({ entry, deps }) {
  const { append, lastLine } = deps || {};
  if (typeof append !== "function" || typeof lastLine !== "function") {
    throw new TypeError("recordDecision: append y lastLine son del adaptador — el kernel no sabe dónde vive el registro");
  }
  const last = lastLine();
  const record = { ts: new Date().toISOString(), ...entry, prev: last == null ? null : sha256(last) };
  append(JSON.stringify(record));
  return record;
}

/** Verifica la cadena completa (lista de líneas jsonl en orden). */
export function verifyDecisionChain(lines) {
  let prevLine = null;
  for (let i = 0; i < lines.length; i++) {
    let rec;
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      return { ok: false, at: i, reason: "línea no parseable" };
    }
    const expected = prevLine == null ? null : sha256(prevLine);
    if (rec.prev !== expected) {
      return { ok: false, at: i, reason: "prev no casa — cadena rota (entrada editada, borrada o reordenada)" };
    }
    prevLine = lines[i];
  }
  return { ok: true, length: lines.length };
}
