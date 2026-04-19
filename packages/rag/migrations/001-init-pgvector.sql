-- Karajan RAG — migración inicial pgvector.
-- Idempotente: puede re-ejecutarse sobre una BD inicializada sin efectos.
-- La dimensión por defecto es 768 (nomic-embed-text); ajustar si se usa otro embedder.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS karajan_rag_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
