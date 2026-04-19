#!/usr/bin/env node
// @ts-check
/**
 * Demo end-to-end del pipeline RAG de Karajan RAG.
 *
 * Este ejemplo NO depende de servicios externos — usa stubs deterministas
 * (HashEmbedder, InMemoryVectorStore, adapter fake). Sirve como test de
 * integración manual y como snippet copy-paste para construir tu propio
 * pipeline sustituyendo los stubs por backends reales (Ollama, pgvector,
 * CLIs reales).
 *
 * Ejecutar:
 *   node examples/run-demo.js
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadTextDirectory } from '../src/ingestion/loaders.js';
import { chunkBySeparators } from '../src/ingestion/chunkers.js';
import { createHashEmbedder } from '../src/embedding/embedder.js';
import { InMemoryVectorStore } from '../src/vector-store/in-memory-vector-store.js';
import { RetrieverRole } from '../src/retrieval/retriever-role.js';
import { GeneratorRole } from '../src/generation/generator-role.js';

/** @type {import('../src/pipeline/types.js').Logger} */
const logger = {
  info: (msg) => console.error(`[demo] ${msg}`),
  warn: (msg) => console.error(`[demo][warn] ${msg}`),
  error: (msg) => console.error(`[demo][error] ${msg}`),
};

/**
 * Adapter fake que simula una respuesta sin spawn real.
 */
async function fakeClaudeAdapter(prompt) {
  return {
    provider: 'claude',
    process: { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false },
    parsedOutput: {
      format: 'json',
      json: {
        answer:
          'RAG es una técnica que combina retrieval y generación. Se indexan documentos como vectores y al consultar se componen prompts con el contexto recuperado [id=doc:001-rag.md, chunk=0].',
      },
      text: '',
    },
  };
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const corpusDir = path.join(here, 'sample-corpus');

  logger.info(`Ingestando corpus desde ${corpusDir}`);
  const documents = await loadTextDirectory(corpusDir);
  logger.info(`Cargados ${documents.length} documentos`);

  const allChunks = [];
  for (const doc of documents) {
    const chunks = chunkBySeparators(doc, { maxSize: 500 });
    allChunks.push(...chunks);
  }
  logger.info(`Generados ${allChunks.length} chunks`);

  const embedder = createHashEmbedder({ dimensions: 64 });
  const store = new InMemoryVectorStore({ dimensions: 64 });
  for (const chunk of allChunks) {
    const vector = await embedder.embed(chunk.content);
    store.upsertOne({
      id: chunk.id,
      vector,
      metadata: { ...chunk.metadata, content: chunk.content, chunkId: chunk.id },
    });
  }
  logger.info(`Indexados ${store.size()} vectores en InMemoryVectorStore`);

  const retriever = new RetrieverRole({
    name: 'retriever',
    logger,
    embedder,
    store,
    defaultTopK: 3,
  });
  const generator = new GeneratorRole({
    name: 'generator',
    logger,
    adapter: fakeClaudeAdapter,
    forceCitation: true,
  });

  const query = '¿Qué es RAG?';
  logger.info(`Query: ${query}`);

  const hits = await retriever.run({ query }, { get: () => null, has: () => false });
  logger.info(`Retriever devolvió ${hits.length} hits`);
  hits.forEach((h, i) =>
    logger.info(`  [${i + 1}] ${h.id} score=${h.score.toFixed(4)}`),
  );

  const generation = await generator.run(
    { query, contextChunks: hits },
    { get: () => null, has: () => false },
  );

  console.log('\n=== Respuesta ===');
  console.log(generation.answer);
  console.log('\n=== Citas extraídas ===');
  console.log(generation.citations);
}

main().catch((err) => {
  console.error('[demo] error fatal:', err);
  process.exitCode = 1;
});
