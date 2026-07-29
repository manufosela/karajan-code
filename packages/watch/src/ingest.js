// @ts-check
/**
 * Ingesta por merge: orquesta `karajan-rag index` sobre el workspace
 * multi-repo de la organización.
 *
 * Convención de workspace (F1): un directorio con UN subdirectorio por
 * repo observado (`workspace/<repo>/…`), de modo que los paths del corpus
 * quedan namespaceados por repo. El workspace debe contener la totalidad
 * de los repos declarados: el manifest incremental de karajan-rag invalida (borra
 * del store) los ficheros ausentes en disco, así que indexar un workspace
 * incompleto destruiría el corpus de los demás repos. Este módulo lo
 * verifica y falla ruidosamente antes de tocar nada.
 *
 * La sensibilidad se estampa generando el `karajan.config.json` que
 * karajan-rag lee en la raíz indexada: nivel global del corpus +
 * `sensitivityRules` por prefijo de repo.
 */
import { readdir, writeFile, access, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/** Error de ingesta: el job debe quedar en rojo, nunca éxito degradado. */
export class IngestError extends Error {
  /**
   * @param {string} message
   * @param {{cause?: unknown}} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'IngestError';
  }
}

/**
 * @typedef {import('./config.js').WatchConfig} WatchConfig
 * @typedef {'code' | 'docs'} CorpusName
 *
 * @typedef {Object} IngestPlan
 * @property {string[]} args Argv para el CLI `karajan-rag`.
 * @property {{easy: Record<string, unknown>}} easyConfig Contenido del `karajan.config.json` a materializar en el workspace.
 */

/**
 * Construye el plan de ingesta para un corpus: argv del CLI y la config
 * easy que estampa la sensibilidad declarada por la capa de despliegue.
 *
 * @param {WatchConfig} config
 * @param {string} corpusName
 * @param {string} workspaceDir
 * @returns {IngestPlan}
 */
export const buildIngestPlan = (config, corpusName, workspaceDir) => {
  if (corpusName !== 'code' && corpusName !== 'docs') {
    throw new IngestError(`corpus "${corpusName}" desconocido (esperado: code | docs).`);
  }
  const corpus = config.corpus[corpusName];
  return {
    args: ['index', workspaceDir, '--store', corpus.store, '--embedder', corpus.embedder],
    easyConfig: {
      easy: {
        store: corpus.store,
        embedder: corpus.embedder,
        sensitivity: corpus.sensitivity,
        // Un prefijo por repo: el nivel declarado para el repo gobierna
        // todo su namespace `<repo>/…` dentro del corpus compartido. La
        // barra final delimita el directorio: `app/` nunca matchea `app-admin/`.
        sensitivityRules: config.repos.map((repo) => ({
          prefix: `${repo.name}/`,
          level: repo.sensitivity,
        })),
      },
    },
  };
};

/**
 * Verifica la convención de workspace multi-repo: cada repo declarado
 * tiene su directorio y no hay entradas ajenas que contaminen el corpus.
 * Se permiten dotfiles (`.karajan/` del manifest) y `karajan.config.json`.
 *
 * @param {WatchConfig} config
 * @param {string} workspaceDir
 * @returns {Promise<void>}
 */
export const verifyWorkspace = async (config, workspaceDir) => {
  let entries;
  try {
    entries = await readdir(workspaceDir, { withFileTypes: true });
  } catch (err) {
    throw new IngestError(`workspace ilegible: "${workspaceDir}".`, { cause: err });
  }
  const declared = new Set(config.repos.map((repo) => repo.name));
  const present = new Set(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );

  const missing = [...declared].filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new IngestError(
      `workspace incompleto: faltan los repos declarados [${missing.join(', ')}] en ` +
        `"${workspaceDir}". Indexar así invalidaría sus chunks en el corpus compartido.`,
    );
  }

  // Solo el manifest y la config generada tienen sitio junto a los repos:
  // cualquier otra entrada (incluidos dotdirs como .git) contaminaría el corpus.
  const allowed = new Set(['.karajan', 'karajan.config.json']);
  const intruders = entries
    .map((entry) => entry.name)
    .filter((name) => !declared.has(name) && !allowed.has(name));
  if (intruders.length > 0) {
    throw new IngestError(
      `workspace contaminado: entradas no declaradas en el config [${intruders.join(', ')}] ` +
        `en "${workspaceDir}".`,
    );
  }
};

/**
 * Ruta real del CLI de karajan-rag.
 *
 * karajan-rag es una DEPENDENCIA, así que su binario vive en el
 * `node_modules` del paquete y no tiene por qué estar en el PATH: confiar
 * en el PATH rompía cualquier instalación que no lo tuviera global
 * (KJW-BUG-0003). Se resuelve desde el propio paquete y se lanza con el
 * node en curso.
 *
 * @returns {Promise<string>}
 */
export const resolveKarajanRagBin = async () => {
  const require = createRequire(import.meta.url);
  let pkgPath;
  try {
    pkgPath = require.resolve('karajan-rag/package.json');
  } catch (err) {
    throw new IngestError(
      'no se pudo localizar el paquete karajan-rag: ¿está instalado como dependencia?',
      { cause: err },
    );
  }
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  const binField = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['karajan-rag'];
  if (!binField) {
    throw new IngestError(
      `el paquete karajan-rag no declara el binario "karajan-rag" en su campo bin.`,
    );
  }
  return resolve(dirname(pkgPath), binField);
};

/**
 * Ejecuta un comando heredando stdio y resuelve con su exit code.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{env: Record<string, string | undefined>}} options
 * @returns {Promise<number>}
 */
const defaultExec = (cmd, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: options.env });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

/**
 * Ingesta end-to-end de un corpus: verifica el workspace, materializa la
 * config de sensibilidad y ejecuta `karajan-rag index`. Cualquier fallo
 * lanza {@link IngestError} (job rojo).
 *
 * @param {Object} params
 * @param {WatchConfig} params.config
 * @param {string} params.workspaceDir
 * @param {string} [params.corpusName]
 * @param {Record<string, string | undefined>} [params.env]
 * @param {(cmd: string, args: string[], options: {env: Record<string, string | undefined>}) => Promise<number>} [params.exec]
 * @param {(msg: string) => void} [params.log]
 * @returns {Promise<{corpusName: CorpusName, workspaceDir: string}>}
 */
export const runIngest = async ({
  config,
  workspaceDir,
  corpusName = 'code',
  env = process.env,
  exec = defaultExec,
  log = (msg) => console.error(`[kjw-ingest] ${msg}`),
}) => {
  const plan = buildIngestPlan(config, corpusName, workspaceDir);
  const corpus = config.corpus[/** @type {CorpusName} */ (corpusName)];

  if (corpus.store === 'pgvector' && !env.PG_URL && !env.DATABASE_URL) {
    throw new IngestError(
      `corpus "${corpusName}" usa pgvector y falta PG_URL (o DATABASE_URL) en el entorno.`,
    );
  }

  await verifyWorkspace(config, workspaceDir);

  const easyConfigPath = join(workspaceDir, 'karajan.config.json');
  const existed = await access(easyConfigPath).then(() => true, () => false);
  if (existed) {
    log(
      `sobrescribiendo karajan.config.json del workspace: la config de despliegue ` +
        `gobierna la sensibilidad del corpus.`,
    );
  }
  await writeFile(easyConfigPath, `${JSON.stringify(plan.easyConfig, null, 2)}\n`, 'utf8');

  log(`indexando corpus "${corpusName}" desde "${workspaceDir}"…`);
  const binPath = await resolveKarajanRagBin();
  const exitCode = await exec(process.execPath, [binPath, ...plan.args], { env });
  if (exitCode !== 0) {
    throw new IngestError(
      `karajan-rag index terminó con exit code ${exitCode} para el corpus "${corpusName}".`,
    );
  }
  return { corpusName: /** @type {CorpusName} */ (corpusName), workspaceDir };
};
