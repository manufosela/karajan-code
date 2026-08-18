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

/** @returns {object} the recorded entry (with ts + who resolved). */
export function recordPolicyException({ projectDir, entry, deps }) {
  const { append, identity } = deps || {};
  if (typeof append !== "function" || typeof identity !== "function") {
    throw new TypeError("recordPolicyException: identity y append son del adaptador — el kernel no sabe quién eres ni dónde persistir");
  }
  const record = { ts: new Date().toISOString(), who: identity(projectDir), ...entry };
  append(projectDir, `${JSON.stringify(record)}\n`);
  return record;
}
