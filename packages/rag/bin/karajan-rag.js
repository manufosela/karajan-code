#!/usr/bin/env node
// @ts-check
/**
 * CLI binario `karajan-rag`.
 *
 * Uso:
 *   karajan-rag run <config.json>
 *   karajan-rag index <ruta> [--store lancedb|pgvector|in-memory] [--embedder hash|transformers] [--dimensions N]
 *
 * `run` ejecuta el pipeline declarado en JSON contra los roles registrados
 * por defecto en un RoleRegistry (actualmente vacío: el usuario debe
 * ampliarlo desde código propio o futuras configuraciones).
 * `index` construye/actualiza el índice local Easy RAG (ADR-005).
 */

import { loadPipelineConfig } from '../src/config/pipeline-config.js';
import { buildPipelineFromConfig } from '../src/config/pipeline-builder.js';
import { RoleRegistry } from '../src/pipeline/role-registry.js';
import {
  runPipeline,
  createPipelineContext,
} from '../src/pipeline/pipeline.js';
import { createDefaultAdapterRegistry } from '../src/ai/adapter-registry.js';
import { runIndexCommand } from '../src/easy/cli.js';

const consoleLogger = {
  info: (msg, meta) => console.error(`[info] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`),
  warn: (msg, meta) => console.error(`[warn] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`),
  error: (msg, meta) => console.error(`[error] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`),
};

/**
 * @returns {Promise<void>}
 */
async function main() {
  const [, , ...args] = process.argv;
  const [command, ...rest] = args;

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(command ? 0 : 2);
  }

  if (command === 'index') {
    try {
      await runIndexCommand(rest);
      process.exit(0);
    } catch (err) {
      console.error(
        `karajan-rag index: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  }

  if (command !== 'run') {
    console.error(`karajan-rag: comando desconocido "${command}".`);
    printUsage();
    process.exit(2);
  }

  const configPath = rest[0];
  if (!configPath) {
    console.error('karajan-rag run: falta la ruta al fichero de configuración.');
    printUsage();
    process.exit(2);
  }

  try {
    const config = await loadPipelineConfig(configPath);
    // El usuario debería ampliar el RoleRegistry con sus propios roles.
    // Por ahora queda vacío; los roles built-in (Retriever/Reranker/Generator)
    // se registrarán desde una capa futura. Si el config usa un rol no
    // registrado, el builder fallará con mensaje útil.
    const registry = new RoleRegistry();
    const stages = buildPipelineFromConfig(config, registry);
    const adapterRegistry = await createDefaultAdapterRegistry();
    const ctx = createPipelineContext({
      logger: consoleLogger,
      tools: {
        get: (name) => adapterRegistry.get(name),
        has: (name) => adapterRegistry.has(name),
      },
      metadata: { pipelineName: config.name },
    });
    const result = await runPipeline(stages, null, ctx, {
      errorPolicy: config.errorPolicy ?? 'abort',
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error(
      `karajan-rag: error fatal: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

function printUsage() {
  console.error('Usage: karajan-rag <comando> [opciones]');
  console.error('');
  console.error('Comandos:');
  console.error('  run <config>   Ejecuta el pipeline declarado en el JSON.');
  console.error('  index <ruta>   Indexa un directorio (código/docs/datos) en .karajan/.');
  console.error('                 Flags: --store lancedb|pgvector|in-memory (default lancedb),');
  console.error('                        --embedder hash|transformers (default hash), --dimensions N.');
  console.error('  --help, -h     Muestra esta ayuda.');
}

main();
