/**
 * Centralized message catalog for pipeline UI strings.
 * Supports i18n by resolving messages for the configured language.
 * Falls back to English when a key or language is missing.
 */

const MESSAGES = {
  en: {
    triage_decompose: "Triage recommends decomposing this task into {count} subtasks:",
    triage_create_cards: "Create these as linked cards in Planning Game (parent: {cardId})?",
    triage_sequential: "Each subtask will block the next one (sequential chain).",
    triage_reply: "Reply: yes / no",
    solomon_conflict: "--- Conflict: {stage} ---",
    solomon_feedback: "Reviewer feedback:",
    solomon_reason: "Solomon could not resolve the conflict:",
    solomon_options: "Options:\n  1. Accept coder's work as-is\n  2. Retry with reviewer's feedback\n  3. Stop the session",
    solomon_proceed: "How should we proceed?",
    checkpoint_continue: "Continue for {minutes} more minutes?",
    checkpoint_options: "1. Continue 5 more minutes\n2. Continue until done (no more checkpoints)\n3. Continue for N minutes (reply with the number)\n4. Stop now",
    preflight_passed: "Preflight passed — all checks OK",
    pipeline_iteration: "Iteration {current}/{max}",
  },
  es: {
    triage_decompose: "Triage recomienda descomponer esta tarea en {count} subtareas:",
    triage_create_cards: "¿Crear estas como cards vinculadas en Planning Game (padre: {cardId})?",
    triage_sequential: "Cada subtarea bloqueará la siguiente (cadena secuencial).",
    triage_reply: "Responde: sí / no",
    solomon_conflict: "--- Conflicto: {stage} ---",
    solomon_feedback: "Feedback del reviewer:",
    solomon_reason: "Solomon no pudo resolver el conflicto:",
    solomon_options: "Opciones:\n  1. Aceptar el trabajo del coder tal cual\n  2. Reintentar con el feedback del reviewer\n  3. Parar la sesión",
    solomon_proceed: "¿Cómo procedemos?",
    checkpoint_continue: "¿Continuar {minutes} minutos más?",
    checkpoint_options: "1. Continuar (5 min)\n2. Continuar hasta terminar\n3. Tiempo personalizado\n4. Parar",
    preflight_passed: "Preflight superado — todas las comprobaciones OK",
    pipeline_iteration: "Iteración {current}/{max}",
  }
};

/**
 * Resolve a message template by key and language, interpolating parameters.
 * Falls back to English, then to the raw key if not found.
 *
 * @param {string} key - Message key (e.g. "solomon_conflict")
 * @param {string} [lang="en"] - 2-letter language code
 * @param {object} [params={}] - Interpolation values (e.g. {stage: "reviewer"})
 * @returns {string}
 */
export function msg(key, lang = "en", params = {}) {
  const template = MESSAGES[lang]?.[key] || MESSAGES.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
}

/**
 * Extract the language code from a Karajan config object.
 * @param {object} [config] - Karajan config
 * @returns {string} 2-letter language code
 */
export function getLang(config) {
  return config?.language || "en";
}
