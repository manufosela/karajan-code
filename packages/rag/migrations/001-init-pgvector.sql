-- Karajan RAG — migración inicial pgvector.
-- Idempotente: puede re-ejecutarse sobre una BD inicializada sin efectos.
-- La dimensión por defecto es 768 (nomic-embed-text); ajustar según el
-- embedder real (la capa Easy RAG usa hash con 256 por defecto — el
-- fingerprint del manifest indica la dimensión del índice).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS karajan_rag_chunks (
  -- text, no uuid: los chunk ids son estables y legibles ("doc:ruta.md#0"),
  -- generados por el chunker — ver KJR-BUG-0002.
  id          text PRIMARY KEY,
  source      text,
  chunk_index integer,
  content     text,
  embedding   vector(768),
  metadata    jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Índice HNSW para cosine similarity.
-- Parámetros por defecto razonables; ajustar m/ef_construction en producción
-- según corpus. Se crea CONCURRENTLY cuando sea posible; IF NOT EXISTS es
-- soportado por PostgreSQL 14+.
CREATE INDEX IF NOT EXISTS karajan_rag_chunks_embedding_hnsw
  ON karajan_rag_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS karajan_rag_chunks_source_idx
  ON karajan_rag_chunks (source);

CREATE INDEX IF NOT EXISTS karajan_rag_chunks_metadata_gin
  ON karajan_rag_chunks
  USING gin (metadata jsonb_path_ops);
