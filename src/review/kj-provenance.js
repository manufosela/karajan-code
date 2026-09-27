/**
 * kj-provenance — KJC-BUG-0222. Un gate que dice QUE falla sin decir CONTRA QUE
 * compara ensena a saltarselo. El aviso del harness decia "does not match the
 * installed kj" y ahi acababa, asi que en campo se leyo como "kj se
 * desincroniza solo": una sesion se monto el ritual de ejecutar `kj harden`
 * antes de cada review y de cada commit, veinte veces en un dia, sin
 * preguntarse por que. La causa estaba entera en el dato que faltaba: ese kj
 * estaba npm-linkado a un arbol de desarrollo cuyas plantillas cambiaron seis
 * veces en dos dias.
 *
 * Saltarse un gate ritualmente es peor que no tenerlo, porque parece que se
 * cumple.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Que kj esta juzgando: version, de donde sale y si es un paquete instalado o
 * un arbol de desarrollo enlazado. Nunca lanza: esto SOLO adorna un mensaje, y
 * un fallo aqui jamas puede cambiar el veredicto de un gate.
 *
 * @returns {{version: string|null, root: string, linked: boolean, label: string}}
 */
export function kjProvenance(moduleDir = here) {
  const root = resolve(moduleDir, "..", "..");
  let version = null;
  try {
    version = createRequire(import.meta.url)(resolve(root, "package.json")).version || null;
  } catch { /* sin manifest legible: se dice lo que se sabe */ }
  // Un kj instalado vive bajo node_modules. Cualquier otra ruta es un arbol de
  // trabajo enlazado (npm link), y entonces sus plantillas se mueven con cada
  // edicion de quien lo desarrolla, en TODOS los proyectos de la maquina.
  const linked = !root.includes(`${"node_modules"}/karajan-code`) && !root.endsWith("node_modules");
  const v = version ? `kj ${version}` : "an unknown kj";
  const label = linked
    ? `${v} LINKED from ${root} (a development tree: its templates move with every edit there, in every project on this machine)`
    : `${v} (${root})`;
  return { version, root, linked, label };
}

const gitIn = (root) => (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/**
 * KJC-TSK-0886: el sello de que kj emite un veredicto. En un arbol enlazado la
 * version no basta (el mismo package.json vale para dos estados del disco), asi
 * que lleva rama y commit del working tree. Nunca lanza: adorna, no decide.
 */
export function kjStamp({ provenance = kjProvenance(), git = gitIn(provenance.root) } = {}) {
  const stamp = { version: provenance.version, linked: provenance.linked };
  if (!provenance.linked) return stamp;
  try {
    return { ...stamp, branch: git(["rev-parse", "--abbrev-ref", "HEAD"]).trim(), commit: git(["rev-parse", "HEAD"]).trim() };
  } catch {
    return stamp;
  }
}

const STAMP_KEYS = ["version", "linked", "branch", "commit"];
export const stampDiffers = (a, b) => Boolean(a && b) && STAMP_KEYS.some((k) => a[k] !== b[k]);

export function stampLabel(s) {
  const where = s.branch ? ` (${s.branch}@${(s.commit || "").slice(0, 7)})` : "";
  return `kj ${s.version ?? "unknown"}${where}`;
}
