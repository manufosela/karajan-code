/**
 * Registro de excepciones del kernel (PL-B KJC-TSK-0734 → GOV-A
 * KJC-TSK-0745) — el modelo probatorio: el valor de una excepción está en
 * QUIÉN la aprobó y con qué contexto, no en la regla que se saltó. Cada
 * entrada liga identidad, regla exacta, justificación escrita EN el
 * momento y hash del artefacto afectado — el alcance es ese artefacto
 * exacto, así que cambiarlo caduca la excepción sola. El kernel NO decide
 * quién es la identidad ni dónde se persiste: `identity` y `append` los
 * INYECTA el adaptador (en code: git+os y .karajan/policy-exceptions.jsonl).
 * La identidad de hoy es DECLARADA, no autenticada — el registro no debe
 * venderse como más evidencia de la que es (GOV-B trae el grado explícito).
 */

// GOV-B (KJC-TSK-0746): alcance con vocabulario CERRADO. `puntual` liga la
// excepción a un artefacto exacto (caducidad implícita: cambia el artefacto
// y muere sola); `permanente` exige caducidad EXPLÍCITA — sin expiresAt no
// hay excepción permanente válida, jamás un "para siempre" silencioso.
const SCOPE_KINDS = new Set(["puntual", "permanente"]);

/** @returns {object} the recorded entry (with ts + who resolved). */
export function recordPolicyException({ projectDir, entry, deps }) {
  const { append, identity } = deps || {};
  if (typeof append !== "function" || typeof identity !== "function") {
    throw new TypeError("recordPolicyException: identity y append son del adaptador — el kernel no sabe quién eres ni dónde persistir");
  }
  const scopeKind = entry.scopeKind ?? "puntual";
  if (!SCOPE_KINDS.has(scopeKind)) {
    throw new TypeError(`recordPolicyException: scopeKind "${entry.scopeKind}" no existe en el vocabulario (${[...SCOPE_KINDS].join(", ")})`);
  }
  // ISO-8601 ESTRICTO (catch de codex: Date.parse traga fechas locales y
  // ambiguas — una caducidad ambigua evaluaría mal el standing después).
  const strictIso = (s) =>
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(s) &&
    !Number.isNaN(Date.parse(s));
  if (scopeKind === "permanente" && !strictIso(entry.expiresAt)) {
    throw new TypeError("recordPolicyException: una excepción permanente exige caducidad — expiresAt en ISO-8601 estricto (p.ej. 2026-09-01T00:00:00Z)");
  }
  // El scopeKind NORMALIZADO va el último: un entry con scopeKind undefined
  // pisaría el valor canónico en el registro (catch de codex).
  const record = { ts: new Date().toISOString(), who: identity(projectDir), ...entry, scopeKind };
  append(projectDir, `${JSON.stringify(record)}\n`);
  return record;
}
