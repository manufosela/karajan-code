/**
 * KJC-TSK-0888 (RAG-P1a, ADR 0011) — pasar al indice por proyecto sin volver a
 * embeber. Los chunks de UN proyecto se copian de la base global de la maquina
 * a <raiz>/.karajan/rag.db con sus embeddings tal cual, junto con su marca de
 * last_indexed_commit para que el auto-update siga por delta. Cero recomputo
 * (en esta maquina, karajan-code son 23.109 chunks), y la base global no se
 * toca: borrarla es decision del usuario, no efecto de una migracion.
 */
import { existsSync } from "node:fs";

import { openVecStore, insertChunk, getLastIndexedCommit, setLastIndexedCommit } from "./vec-store.js";

/**
 * @returns {{state: "migrated"|"already"|"nothing", migrated: number, reason: string}}
 */
export function migrateProjectIndex({ slug, legacyPath, targetPath, dim = 768 }) {
  const nothing = { state: "nothing", migrated: 0, reason: `the global index holds nothing for ${slug}: kj rag index --with-sources` };
  if (!existsSync(legacyPath)) return nothing;

  const target = openVecStore({ dim, path: targetPath });
  try {
    // Se cuentan los de ESTE proyecto, no el total: un rag.db viejo en
    // .karajan/ puede traer chunks de otro (visto en esta maquina: 42 de otro
    // repo), y contar el total diria "ya migrado" sin haber copiado nada.
    const mine = target.prepare("SELECT COUNT(*) AS n FROM chunks WHERE project_slug = ?").get(slug).n;
    if (mine > 0) {
      return { state: "already", migrated: 0, reason: `the project index already holds ${mine} chunks of ${slug}: nothing to migrate` };
    }
    const legacy = openVecStore({ dim, path: legacyPath });
    try {
      const rows = legacy.prepare("SELECT id, source, kind, text, metadata, content_hash FROM chunks WHERE project_slug = ?").all(slug);
      if (rows.length === 0) return nothing;
      const vecOf = legacy.prepare("SELECT embedding FROM vec_chunks WHERE rowid = ?");
      const copy = target.transaction(() => {
        for (const r of rows) {
          const raw = vecOf.get(BigInt(r.id))?.embedding;
          if (!raw) continue; // un chunk sin vector no se puede buscar: no se inventa
          const embedding = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
          insertChunk(target, { source: r.source, kind: r.kind, text: r.text, metadata: r.metadata, embedding, project: slug, contentHash: r.content_hash });
        }
      });
      copy();
      const stamp = getLastIndexedCommit(legacy, slug);
      if (stamp) setLastIndexedCommit(target, slug, stamp);
      const migrated = target.prepare("SELECT COUNT(*) AS n FROM chunks WHERE project_slug = ?").get(slug).n;
      const parts = [`${migrated} chunks of ${slug} copied with their embeddings`];
      if (stamp) parts.push(`indexed at ${stamp.slice(0, 9)}`);
      return { state: "migrated", migrated, reason: parts.join(", ") };
    } finally {
      legacy.close();
    }
  } finally {
    target.close();
  }
}
