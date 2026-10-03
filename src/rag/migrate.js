/**
 * KJC-TSK-0888 (RAG-P1a, ADR 0011) — pasar al indice por proyecto sin volver a
 * embeber. Los chunks de UN proyecto se copian de la base global de la maquina
 * a <raiz>/.karajan/rag.db con sus embeddings tal cual, junto con su marca de
 * last_indexed_commit para que el auto-update siga por delta. Cero recomputo
 * (en esta maquina, karajan-code son 23.109 chunks), y la base global no se
 * toca: borrarla es decision del usuario, no efecto de una migracion.
 */
import { existsSync } from "node:fs";
import { sep } from "node:path";

import { openVecStore, insertChunk, getLastIndexedCommit, setLastIndexedCommit } from "./vec-store.js";

export const countProjectChunks = (db, slug) => db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE project_slug = ?").get(slug).n;

/**
 * KJC-BUG-0258: chunks of the project's OWN files (sources under projectDir), as
 * opposed to its plans and briefs. A prefix compare, not LIKE: paths may hold % or _.
 */
export const countProjectSources = (db, slug, projectDir) => {
  // path.sep: sources are stored as native paths (backslashes on Windows).
  const prefix = projectDir.replace(/[\\/]+$/, "") + sep;
  return db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE project_slug = ? AND substr(source, 1, ?) = ?").get(slug, prefix.length, prefix).n;
};

/**
 * KJC-TSK-0882: que decir cuando el indice del proyecto no tiene nada suyo.
 * Si la base global tiene sus chunks, migrar (segundos); si no, indexar.
 */
export function emptyIndexRemedy({ slug, legacyPath, dim = 768 }) {
  if (slug && existsSync(legacyPath)) {
    const legacy = openVecStore({ dim, path: legacyPath });
    try {
      if (countProjectChunks(legacy, slug) > 0) return "kj rag migrate";
    } finally {
      legacy.close();
    }
  }
  return "kj rag index --with-sources";
}

/**
 * KJC-BUG-0255: `keep(source)` is the indexer's criterion today (generated,
 * excluded, .ragignore, sensitive, gone). The global index was filled before
 * those rules, so copying it blind brought vendor/*.min.js along as noise.
 * @returns {{state: "migrated"|"already"|"nothing", migrated: number, skipped?: number, reason: string}}
 */
export function migrateProjectIndex({ slug, legacyPath, targetPath, dim = 768, keep = () => true }) {
  const nothing = { state: "nothing", migrated: 0, reason: `the global index holds nothing for ${slug}: kj rag index --with-sources` };
  if (!existsSync(legacyPath)) return nothing;

  const target = openVecStore({ dim, path: targetPath });
  try {
    // Se cuentan los de ESTE proyecto, no el total: un rag.db viejo en
    // .karajan/ puede traer chunks de otro (visto en esta maquina: 42 de otro
    // repo), y contar el total diria "ya migrado" sin haber copiado nada.
    const mine = countProjectChunks(target, slug);
    if (mine > 0) {
      return { state: "already", migrated: 0, reason: `the project index already holds ${mine} chunks of ${slug}: nothing to migrate` };
    }
    const legacy = openVecStore({ dim, path: legacyPath });
    try {
      const rows = legacy.prepare("SELECT id, source, kind, text, metadata, content_hash FROM chunks WHERE project_slug = ?").all(slug);
      if (rows.length === 0) return nothing;
      const vecOf = legacy.prepare("SELECT embedding FROM vec_chunks WHERE rowid = ?");
      let skipped = 0;
      const copy = target.transaction(() => {
        for (const r of rows) {
          if (!keep(r.source)) { skipped++; continue; }
          const raw = vecOf.get(BigInt(r.id))?.embedding;
          if (!raw) continue; // un chunk sin vector no se puede buscar: no se inventa
          const embedding = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
          insertChunk(target, { source: r.source, kind: r.kind, text: r.text, metadata: r.metadata, embedding, project: slug, contentHash: r.content_hash });
        }
      });
      copy();
      const stamp = getLastIndexedCommit(legacy, slug);
      if (stamp) setLastIndexedCommit(target, slug, stamp);
      const migrated = countProjectChunks(target, slug);
      const parts = [`${migrated} chunks of ${slug} copied with their embeddings`];
      if (stamp) parts.push(`indexed at ${stamp.slice(0, 9)}`);
      if (skipped) parts.push(`${skipped} left out (the indexer would not take them today: generated, excluded or gone)`);
      return { state: "migrated", migrated, skipped, reason: parts.join(", ") };
    } finally {
      legacy.close();
    }
  } finally {
    target.close();
  }
}
