/**
 * KJC-TSK-0850 (ADR 0010, RAG-D) — index coverage as a defect. A gate built
 * on the RAG protects nothing it cannot see, so the sources the indexer's
 * OWN matchers would take (src/, scripts/, bin/, packages/*: the walker
 * takes the whole repo minus the skip segments) are compared against the
 * chunks the store holds for this project, and against the commit the
 * index was stamped with. No config declares the directories twice: the
 * matchers are the single truth, here and in the indexer.
 */
import { execa } from "execa";
import { extname, isAbsolute, normalize, relative } from "node:path";
import { detectAdaptersForProject, buildMatchers } from "../lang/registry.js";
import { GENERATED_CONFIG_FILES } from "../harden/config-templates.js";
import { getLastIndexedCommit, projectSlug } from "./vec-store.js";


/**
 * KJC-BUG-0221 — `kj harden` instala commitlint.config.js y eslint.config.js, y
 * la cobertura los exigia indexados, asi que `kj check` denunciaba como drift
 * dos ficheros que kj mismo acababa de escribir: la herramienta creando el
 * fichero y quejandose de el. El criterio es el que ya usa el presupuesto de
 * LOC (src/review/loc-budget.js): lo generado no cuenta, porque nadie lo
 * escribio, y el RAG existe para responder sobre el codigo del equipo.
 *
 * La lista sale de la propia tabla de plantillas de harden, para que anadir un
 * config no obligue a acordarse de esta otra lista.
 */
export function isGeneratedByHarden(rel) {
  if (!rel) return false;
  const base = rel.split("/").pop();
  return GENERATED_CONFIG_FILES.has(base);
}

/**
 * @param {string} projectDir
 * @param {{db: object}} deps - an open vec store
 * @returns {Promise<{project: string, total: number, indexed: number, missing: string[], stale: string[], lastIndexedCommit: string|null, absent: boolean}>}
 */
export async function ragIndexCoverage(projectDir, { db }) {
  const project = projectSlug(projectDir);
  const matchers = buildMatchers(detectAdaptersForProject(projectDir));
  const { stdout } = await execa("git", ["-C", projectDir, "ls-files", "-z"]);
  const all = stdout.split("\0").filter((p) => p && matchers.isCodeFile(p) && !matchers.shouldSkip(p));
  // Lo que kj genera se informa aparte: ni se exige indexado ni se esconde.
  const generated = all.filter(isGeneratedByHarden);
  const sources = all.filter((p) => !isGeneratedByHarden(p));

  const rows = db.prepare("SELECT DISTINCT source FROM chunks WHERE kind = 'code' AND project_slug = ?").all(project);
  const indexed = new Set(rows.map((r) => (isAbsolute(r.source) ? relative(projectDir, r.source) : r.source)));
  const missing = sources.filter((p) => !indexed.has(p));

  const lastIndexedCommit = getLastIndexedCommit(db, project);
  let stale = [];
  if (lastIndexedCommit) {
    // Files the repo changed after the stamp: the delta update has not seen
    // them yet, so what the store says about them is old.
    // The stamp must be an ANCESTOR of HEAD: a commit that still exists but
    // sits on a rewritten branch would diff fine and report selective
    // staleness, when in truth freshness is unknown. Fail closed.
    const ancestor = await execa("git", ["-C", projectDir, "merge-base", "--is-ancestor", lastIndexedCommit, "HEAD"], { reject: false });
    if (ancestor.exitCode !== 0) {
      throw new Error(`the RAG index stamp ${lastIndexedCommit.slice(0, 9)} is not reachable from HEAD — kj rag index --with-sources`);
    }
    const diff = await execa("git", ["-C", projectDir, "diff", "--name-only", lastIndexedCommit, "HEAD"]);
    const changed = new Set(diff.stdout.split("\n").filter(Boolean));
    stale = sources.filter((p) => indexed.has(p) && changed.has(p));
  }

  return { project, total: sources.length, indexed: sources.length - missing.length, missing, stale, generated, lastIndexedCommit, absent: indexed.size === 0 };
}

/**
 * KJC-BUG-0216 (issue #1807) — POR QUE el RAG no puede responder sobre un
 * fichero. El gate rag-first exigia una respuesta sobre cualquier fichero
 * tocado, y para un .astro (o .php, o cualquier lenguaje sin adapter) eso es
 * imposible: el indexador nunca lo toma. La unica salida era KJ_ALLOW_NO_RAG
 * puesta por costumbre en todos los comandos, y con ella puesta el gate deja de
 * informar y borra la diferencia entre "no pude consultar" y "no quise".
 *
 * `canAnswer` es la respuesta que el gate necesita: solo cuando es true tiene
 * sentido exigir que el RAG haya hablado de ese fichero.
 *
 * @returns {{state: "indexed"|"stale"|"not-indexable"|"index-empty", rel: string, canAnswer: boolean, reason: string}}
 */
export function fileIndexState(projectDir, file, { db }) {
  const project = projectSlug(projectDir);
  // `./src/a.js` y `src/a.js` son el mismo fichero: sin normalizar, el segundo
  // salia "stale" estando indexado (catch de la review).
  const rel = normalize(isAbsolute(file) ? relative(projectDir, file) : file);
  const matchers = buildMatchers(detectAdaptersForProject(projectDir));
  const rows = db.prepare("SELECT DISTINCT source FROM chunks WHERE project_slug = ?").all(project);
  const indexed = new Set(rows.map((r) => normalize(isAbsolute(r.source) ? relative(projectDir, r.source) : r.source)));

  if (indexed.has(rel)) return { state: "indexed", rel, canAnswer: true, reason: `the index holds chunks for ${rel}` };
  if (indexed.size === 0) return { state: "index-empty", rel, canAnswer: false, reason: `nothing of this project is indexed yet: kj rag index` };
  if (matchers.shouldSkip(rel)) return { state: "not-indexable", rel, canAnswer: false, reason: `${rel} lives under a path the indexer always skips` };
  if (!matchers.isCodeFile(rel) && extname(rel).toLowerCase() !== ".md") {
    return { state: "not-indexable", rel, canAnswer: false, reason: `no language adapter covers ${extname(rel) || "a file with no extension"}, so the indexer never takes ${rel}` };
  }
  // KJC-TSK-0891: `--since auto` only reaches what changed, so it cannot fix an
  // unchanged file the index never held; indexing THIS file does.
  return { state: "stale", rel, canAnswer: false, reason: `${rel} is indexable but absent from the index: kj rag index --file ${rel}` };
}
