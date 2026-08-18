// @ts-check

/**
 * @typedef {"email" | "phone" | "nif" | "nie" | "creditCard" | "iban"} PiiKind
 */

/**
 * @typedef {Object} RedactionReport
 * @property {string} text Texto ya redactado.
 * @property {Record<PiiKind, number>} counts Conteo por tipo encontrado.
 * @property {number} total Total de reemplazos.
 */

// Regex del mundo real, no pretende ser perfecto pero cubre los casos típicos
// ES + internacionales sencillos. Defensa en profundidad, NO único control.
// Orden importa: patrones más específicos primero para que los genéricos
// (como teléfono) no se coman matches de NIF/NIE/tarjeta.
const PATTERNS = /** @type {Array<{ kind: PiiKind, regex: RegExp, placeholder: string }>} */ ([
  {
    kind: 'email',
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    placeholder: '[REDACTED_EMAIL]',
  },
  {
    // Antes que creditCard: un IBAN contiene tiradas largas de dígitos que
    // el patrón de tarjeta se comería a trozos (H3, auditoría 2026-07).
    kind: 'iban',
    regex: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){2,7}(?:[ -]?[A-Z0-9]{1,4})?\b/g,
    placeholder: '[REDACTED_IBAN]',
  },
  {
    kind: 'creditCard',
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    placeholder: '[REDACTED_CARD]',
  },
  {
    kind: 'nif',
    regex: /\b\d{8}[-.]?[A-HJ-NP-TV-Z]\b/gi,
    placeholder: '[REDACTED_ID]',
  },
  {
    kind: 'nie',
    regex: /\b[XYZxyz][-.]?\d{7}[-.]?[A-HJ-NP-TV-Z]\b/gi,
    placeholder: '[REDACTED_ID]',
  },
  {
    kind: 'phone',
    regex: /\+?\d{1,3}[ .-]?(?:\(?\d{2,4}\)?[ .-]?)?\d{3}[ .-]?\d{3,4}(?:[ .-]?\d{2,4})?/g,
    placeholder: '[REDACTED_PHONE]',
  },
]);

/**
 * Redacta PII detectada en el texto (regex-based).
 *
 * Aplica los patrones en orden: email → IBAN → creditCard → NIF → NIE →
 * phone. El orden importa: teléfonos podrían match sobre trozos de
 * tarjetas (y tarjetas sobre trozos de IBAN) si se invirtiese.
 *
 * @param {string} text
 * @returns {RedactionReport}
 */
export function redactPII(text) {
  if (typeof text !== 'string') {
    throw new Error('redactPII: se esperaba un string.');
  }
  /** @type {Record<PiiKind, number>} */
  const counts = { email: 0, phone: 0, nif: 0, nie: 0, creditCard: 0, iban: 0 };
  // KJR-BUG-0009: sin normalizar, "cliente＠empresa.com" (fullwidth) o un
  // IBAN con thin spaces sobreviven a las regex ASCII. NFKC pliega los
  // compatibles (＠→@, dígitos fullwidth→ASCII) y el replace cubre los
  // espacios Unicode sin descomposición de compatibilidad. El texto
  // devuelto queda normalizado — aceptable: su destino es un prompt.
  // Los zero-width (ZWSP/ZWNJ/ZWJ/WJ/BOM) se ELIMINAN \u2014 mapearlos a
  // espacio partir\u00EDa la PII en trozos que las regex no ver\u00EDan. L\u00EDmite
  // conocido (audit \u00A74 H3): homoglifos de otros alfabetos (\u043F cir\u00EDlica\u2026)
  // no se pliegan con NFKC y redactan solo el tramo ASCII.
  let current = text
    .normalize('NFKC')
    .replace(/\u200B|\u200C|\u200D|\u2060|\uFEFF/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
  for (const { kind, regex, placeholder } of PATTERNS) {
    const matches = current.match(regex);
    if (matches) {
      counts[kind] += matches.length;
      current = current.replace(regex, placeholder);
    }
  }
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { text: current, counts, total };
}
