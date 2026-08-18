// glob → RegExp anclada — primitivo de la policy layer (PL-A, KJC-TSK-0733).
// Semántica: doble asterisco cruza directorios; doble asterisco + barra es
// prefijo de directorio OPCIONAL (así "**" "/*.env*" casa también con .env
// en la raíz); "*" no sale de su segmento; "?" es un carácter. Sin
// dependencias: el vocabulario es pequeño a propósito — una lib general
// traería semánticas que la policy no declara.
export function globToRegExp(glob) {
  let re = "";
  const s = String(glob);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "*" && s[i + 1] === "*" && s[i + 2] === "/") {
      re += "(?:.*/)?";
      i += 3;
    } else if (c === "*" && s[i + 1] === "*") {
      re += ".*";
      i += 2;
    } else if (c === "*") {
      re += "[^/]*";
      i += 1;
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else {
      re += c.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`);
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

/** true si `value` casa con ALGUNO de los globs (lista no-array ⇒ false). */
export const matchesAny = (value, globs) =>
  Array.isArray(globs) && globs.some((g) => globToRegExp(g).test(value));

/** Patrón de comando shell → RegExp anclada al INICIO: `*` = cualquier cosa
 *  (los comandos no son rutas — sin semántica de segmentos). */
export function commandPatternToRegExp(pattern) {
  const re = String(pattern)
    .replaceAll(/[.+^${}()|[\]\\?]/g, String.raw`\$&`)
    .replaceAll("*", ".*");
  return new RegExp(`^${re}`);
}
