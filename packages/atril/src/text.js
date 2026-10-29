/**
 * Text folding shared by search and enrich (ADR 0038, layer 1): lowercase, then
 * strip combining marks after NFD, so `Búsqueda` and `busqueda` (and `año` and
 * `ano`) are the same token. Pure ASCII is unchanged.
 */
export const fold = (text) => String(text).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
