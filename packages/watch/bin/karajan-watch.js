#!/usr/bin/env node
// @ts-check
/**
 * CLI `karajan-watch`.
 *
 * Uso:
 *   karajan-watch ingest [--config karajan-watch.config.json] [--workspace <dir>] [--corpus code|docs]
 *
 * `ingest` valida el config de despliegue, verifica la convención de
 * workspace multi-repo y ejecuta `karajan-rag index` sobre el workspace.
 * Cualquier fallo termina con exit code != 0 (job rojo).
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { ConfigError, loadConfig } from '../src/config.js';
import { IngestError, runIngest } from '../src/ingest.js';

const printUsage = () => {
  console.error(
    'Uso: karajan-watch ingest [--config karajan-watch.config.json] ' +
      '[--workspace <dir>] [--corpus code|docs]',
  );
};

const main = async () => {
  const [, , command, ...rest] = process.argv;

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(command ? 0 : 2);
  }

  if (command !== 'ingest') {
    console.error(`comando desconocido: "${command}".`);
    printUsage();
    process.exit(2);
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      config: { type: 'string', default: 'karajan-watch.config.json' },
      workspace: { type: 'string' },
      corpus: { type: 'string', default: 'code' },
    },
  });

  if (!values.workspace) {
    console.error('ingest: falta --workspace <dir> (raíz del workspace multi-repo).');
    process.exit(2);
  }

  const config = await loadConfig(resolve(values.config));
  await runIngest({
    config,
    workspaceDir: resolve(values.workspace),
    corpusName: values.corpus,
  });
};

main().catch((err) => {
  if (err instanceof ConfigError || err instanceof IngestError) {
    console.error(`[karajan-watch] ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
