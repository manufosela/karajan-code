// @ts-check
/**
 * Textos del sync según el idioma de la fuente (`sourceLang` en el config).
 * Las fuentes históricas están en español (traducción EN en la raíz); atril
 * es al revés: fuente EN y traducción en `es/`. Un idioma desconocido falla.
 */
const TEXTS = {
  es: {
    banner: 'NO EDITAR A MANO — regenerado con `npm run sync:family-docs`',
    stale: (dir, declared, actual) =>
      `EN obsoleta: ${dir} traduce ${declared}… pero la fuente es ${actual}… — retraducir y actualizar la marca`,
    missing: (pagePath, label) => `EN ausente: ${pagePath} (traducir desde ${label})`,
    noMark: (pagePath) => `la página EN ${pagePath} no declara source-sha256 — añade su marca de procedencia`,
  },
  en: {
    banner: 'DO NOT EDIT BY HAND — regenerated with `npm run sync:family-docs`',
    stale: (dir, declared, actual) =>
      `Stale translation: ${dir} translates ${declared}… but the source is ${actual}… — retranslate and update the mark`,
    missing: (pagePath, label) => `Translation missing: ${pagePath} (translate from ${label})`,
    noMark: (pagePath) => `translation ${pagePath} does not declare source-sha256 — add its provenance mark`,
  },
};

const textsFor = (/** @type {string | undefined} */ lang = 'es') => {
  if (!Object.hasOwn(TEXTS, lang)) throw new Error(`sourceLang "${lang}" no soportado (es | en)`);
  return TEXTS[/** @type {'es' | 'en'} */ (lang)];
};

export const missingMessage = (lang, pagePath, label) =>
  textsFor(lang).missing(pagePath, label);

export const noMarkMessage = (lang, pagePath) => textsFor(lang).noMark(pagePath);

export const bannerFor = (lang, label, hash) =>
  `<!-- synced-from: ${label} · section-sha256: ${hash}\n     ${textsFor(lang).banner} -->`;

export const staleMessage = (lang, pagePath, declared, actual) =>
  textsFor(lang).stale(pagePath, declared.slice(0, 12), actual.slice(0, 12));
