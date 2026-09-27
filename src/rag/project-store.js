/**
 * KJC-TSK-0882 (RAG-P1, ADR 0011) — el indice del RAG es DEL PROYECTO.
 *
 * Hasta aqui era una sola base por maquina (~/.karajan/rag.db): 427 MB, 19
 * proyectos y 49.825 chunks en un indice vectorial sin particion. La KNN sacaba
 * los vecinos mas cercanos de TODA la maquina y filtraba por proyecto despues,
 * asi que un proyecto pequeno podia recibir cero resultados con el chunk
 * perfecto indexado, y cinco consultas ni siquiera filtraban (una de ellas, el
 * preload que entra en el prompt del coder).
 *
 * Ahora cada proyecto abre <raiz git>/.karajan/rag.db. La raiz se resuelve por
 * git para que desde un subdirectorio se vea el mismo indice. KJ_RAG_DB sigue
 * mandando cuando esta puesta. El store de karajan-core ya acepta `path`, asi
 * que esto no toca core.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { openVecStore } from "./vec-store.js";
import { getKarajanHome } from "../utils/paths.js";

function projectRoot(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || dir;
  } catch {
    return dir;
  }
}

/** Ruta del indice del proyecto. */
export function projectDbPath(projectDir = process.cwd()) {
  if (process.env.KJ_RAG_DB) return process.env.KJ_RAG_DB;
  return path.join(projectRoot(projectDir), ".karajan", "rag.db");
}

/** Abre el indice del proyecto. El caller es dueno del close(). */
/** KJC-TSK-0883: the machine canon has its own store, never a project's. */
export function libraryDbPath() {
  return process.env.KJ_LIBRARY_DB || path.join(getKarajanHome(), "library.db");
}

export function openLibraryStore({ dim = 768 } = {}) {
  return openVecStore({ dim, path: libraryDbPath() });
}

export function openProjectStore({ projectDir = process.cwd(), dim = 768 } = {}) {
  return openVecStore({ dim, path: projectDbPath(projectDir) });
}
