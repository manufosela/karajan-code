// glob → RegExp anclada — primitivo de la policy layer (PL-A, KJC-TSK-0733).
// Semántica: doble asterisco cruza directorios; doble asterisco + barra es
// prefijo de directorio OPCIONAL (así "**" "/*.env*" casa también con .env
// en la raíz); "*" no sale de su segmento; "?" es un carácter. Sin
// dependencias: el vocabulario es pequeño a propósito — una lib general
// traería semánticas que la policy no declara.
export function globToRegExp(glob) {
  let re = "";
  const s = String(glob);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "*") {
      if (s[i + 1] === "*") {
        if (s[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i++;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/** true si `value` casa con ALGUNO de los globs (lista no-array ⇒ false). */
export const matchesAny = (value, globs) =>
  Array.isArray(globs) && globs.some((g) => globToRegExp(g).test(value));
