#!/usr/bin/env node
// @ts-check
/**
 * CLI `karajan-watch`.
 *
 * Uso:
 *   karajan-watch ingest [--config karajan-watch.config.json] [--workspace <dir>] [--corpus code|docs]
 *   karajan-watch impact --workspace <dir> --repo <name> --diff <fichero|-> [--no-deliver] [--pr-number N]
 *   karajan-watch drift  --workspace <dir> --repo <name> --diff <fichero|-> [--judge] [--no-deliver] [--pr-number N]
 *
 * `ingest` valida el config de despliegue, verifica la convención de
 * workspace multi-repo y ejecuta `karajan-rag index` sobre el workspace.
 * `impact` ejecuta el pipeline completo de impacto cross-repo sobre el
 * diff de un merge e imprime el informe en markdown por stdout.
 * `drift` hace lo mismo contra el corpus docs: documentación que puede
 * quedar desactualizada (juicio LLM opcional con --judge).
 * Cualquier fallo termina con exit code != 0 (job rojo).
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { ConfigError, loadConfig } from '../src/config.js';
import { IngestError, runIngest } from '../src/ingest.js';
import { ImpactError, runImpactPipeline } from '../src/impact.js';
import { runDriftPipeline } from '../src/drift.js';

const printUsage = () => {
  console.error(
    'Uso: karajan-watch ingest [--config karajan-watch.config.json] ' +
      '[--workspace <dir>] [--corpus code|docs]\n' +
      '     karajan-watch impact --workspace <dir> --repo <name> --diff <fichero|-> ' +
      '[--config karajan-watch.config.json] [--corpus code|docs] [--no-deliver] [--pr-number N]\n' +
      '     karajan-watch drift  --workspace <dir> --repo <name> --diff <fichero|-> ' +
      '[--config karajan-watch.config.json] [--judge] [--no-deliver] [--pr-number N]',
  );
};

/**
 * Lee el diff desde un fichero o stdin ('-').
 *
 * @param {string} source
 * @returns {Promise<string>}
 */
const readDiff = async (source) => {
  if (source === '-') {
    // Buffers concatenados y decodificados de una vez: un carácter UTF-8
    // partido entre chunks corrompería el diff si se decodifica por trozos.
    const pieces = [];
    for await (const piece of process.stdin) pieces.push(piece);
    return Buffer.concat(pieces).toString('utf8');
  }
  return readFile(resolve(source), 'utf8');
};

/**
 * Construye el contexto de PR desde flags y entorno de GitHub Actions.
 *
 * @param {string | undefined} prNumberFlag
 * @returns {{repoSlug: string, prNumber: number, token: string} | undefined}
 */
const prContextFromEnv = (prNumberFlag) => {
  const repoSlug = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const prNumber = prNumberFlag ? Number.parseInt(prNumberFlag, 10) : NaN;
  if (!repoSlug || !token || Number.isNaN(prNumber)) return undefined;
  return { repoSlug, prNumber, token };
};

const main = async () => {
  const [, , command, ...rest] = process.argv;

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(command ? 0 : 2);
  }

  if (command !== 'ingest' && command !== 'impact' && command !== 'drift') {
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
      repo: { type: 'string' },
      diff: { type: 'string' },
      judge: { type: 'boolean', default: false },
      'no-deliver': { type: 'boolean', default: false },
      'pr-number': { type: 'string' },
    },
  });

  if (!values.workspace) {
    console.error(`${command}: falta --workspace <dir> (raíz del workspace multi-repo).`);
    process.exit(2);
  }

  const config = await loadConfig(resolve(values.config));

  if (command === 'ingest') {
    await runIngest({
      config,
      workspaceDir: resolve(values.workspace),
      corpusName: values.corpus,
    });
    return;
  }

  if (!values.repo || !values.diff) {
    console.error(`${command}: faltan --repo <name> y/o --diff <fichero|->.`);
    process.exit(2);
  }
  const shared = {
    config,
    workspaceDir: resolve(values.workspace),
    repoName: values.repo,
    diffText: await readDiff(values.diff),
    deliver: !values['no-deliver'],
    prContext: prContextFromEnv(values['pr-number']),
  };
  const result =
    command === 'impact'
      ? await runImpactPipeline({
          ...shared,
          corpusName: /** @type {'code' | 'docs'} */ (values.corpus),
        })
      : await runDriftPipeline({ ...shared, judge: values.judge });
  console.log(result.markdown);
};

main().catch((err) => {
  if (err instanceof ConfigError || err instanceof IngestError || err instanceof ImpactError) {
    console.error(`[karajan-watch] ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
