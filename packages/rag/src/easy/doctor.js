// @ts-check
/**
 * karajan-rag doctor — diagnóstico de entorno e índice (roadmap 0.6.0).
 *
 * Chequeos best-effort y sin efectos: presencia de peers opcionales,
 * CLIs de IA en PATH, variables de entorno, config del proyecto y estado
 * del índice. No abre conexiones reales (probar PG/Ollama sería lento y
 * con efectos); cada ✗ incluye el paso exacto para arreglarlo.
 */
import path from 'node:path';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { loadEasyConfig, CONFIG_FILE } from './config.js';
import { loadManifest } from './manifest.js';

/**
 * @typedef {object} DoctorCheck
 * @property {string} name
 * @property {'ok' | 'warn' | 'error'} level
 * @property {string} detail
 * @property {string} [fix] Paso exacto para arreglarlo (solo warn/error).
 *
 * @typedef {object} DoctorDeps
 * @property {Record<string, string | undefined>} [env]
 * @property {(specifier: string) => Promise<unknown>} [importModule] Inyectable en tests.
 * @property {(bin: string) => Promise<boolean>} [whichBin] Inyectable en tests.
 * @property {string} [nodeVersion] Inyectable en tests.
 */

const OPTIONAL_PEERS = Object.freeze([
  { name: '@lancedb/lancedb', why: 'store local por defecto (index/query/serve)' },
  { name: '@huggingface/transformers', why: 'embedder semántico --embedder transformers' },
  { name: 'pg', why: 'store pgvector (--store pgvector)' },
]);

const AI_CLIS = Object.freeze(['claude', 'codex', 'gemini', 'ollama']);

/**
 * Busca un binario en el PATH sin spawnearlo.
 *
 * @param {string} bin
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<boolean>}
 */
async function defaultWhichBin(bin, env) {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    try {
      await access(join(dir, bin));
      return true;
    } catch {
      // seguir buscando
    }
  }
  return false;
}

/**
 * Ejecuta todos los chequeos y devuelve el listado (puro, sin imprimir).
 *
 * @param {string} rootDir
 * @param {DoctorDeps} [deps]
 * @returns {Promise<DoctorCheck[]>}
 */
export async function runDoctorChecks(rootDir, deps = {}) {
  const env = deps.env ?? process.env;
  const importModule = deps.importModule ?? ((specifier) => import(specifier));
  const whichBin = deps.whichBin ?? ((bin) => defaultWhichBin(bin, env));
  const nodeVersion = deps.nodeVersion ?? process.versions.node;

  /** @type {DoctorCheck[]} */
  const checks = [];

  // 1. Node
  const major = Number.parseInt(nodeVersion.split('.')[0], 10);
  checks.push(
    major >= 18
      ? { name: 'node', level: 'ok', detail: `v${nodeVersion}` }
      : {
          name: 'node',
          level: 'error',
          detail: `v${nodeVersion} — se requiere >= 18`,
          fix: 'Instala Node 18+ (nvm install --lts).',
        },
  );

  // 2. Peers opcionales
  for (const peer of OPTIONAL_PEERS) {
    try {
      await importModule(peer.name);
      checks.push({ name: `peer ${peer.name}`, level: 'ok', detail: peer.why });
    } catch {
      checks.push({
        name: `peer ${peer.name}`,
        level: 'warn',
        detail: `no instalado — ${peer.why}`,
        fix: `pnpm add ${peer.name}`,
      });
    }
  }

  // 3. CLIs de IA en PATH
  /** @type {string[]} */
  const foundClis = [];
  for (const cli of AI_CLIS) {
    if (await whichBin(cli)) foundClis.push(cli);
  }
  checks.push(
    foundClis.length > 0
      ? { name: 'CLIs de IA', level: 'ok', detail: foundClis.join(', ') }
      : {
          name: 'CLIs de IA',
          level: 'warn',
          detail: 'ninguno en PATH (claude/codex/gemini/ollama)',
          fix: 'Instala al menos uno para query --answer y jueces LLM, o usa los adapters HTTP (runOpenAi/runAnthropic).',
        },
  );

  // 4. Variables de entorno relevantes
  const envVars = ['PG_URL', 'DATABASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
  const present = envVars.filter((name) => Boolean(env[name]));
  checks.push({
    name: 'env',
    level: 'ok',
    detail: present.length > 0 ? `definidas: ${present.join(', ')}` : 'sin credenciales externas (modo local puro)',
  });

  // 5. Config del proyecto
  try {
    const config = await loadEasyConfig(rootDir);
    checks.push(
      config === null
        ? {
            name: CONFIG_FILE,
            level: 'warn',
            detail: 'ausente — se aplican defaults ADR-005',
            fix: `karajan-rag init ${rootDir}`,
          }
        : { name: CONFIG_FILE, level: 'ok', detail: JSON.stringify(config) },
    );
  } catch (err) {
    checks.push({
      name: CONFIG_FILE,
      level: 'error',
      detail: err instanceof Error ? err.message : String(err),
      fix: `Corrige el fichero o regenera con: karajan-rag init ${rootDir} --force`,
    });
  }

  // 6. Índice
  try {
    const manifest = await loadManifest(rootDir);
    if (manifest === null) {
      checks.push({
        name: 'índice',
        level: 'warn',
        detail: `sin índice en ${path.join(rootDir, '.karajan')}`,
        fix: `karajan-rag index ${rootDir}`,
      });
    } else {
      const files = Object.keys(manifest.files).length;
      const chunks = Object.values(manifest.files).reduce((s, f) => s + f.chunkIds.length, 0);
      checks.push({
        name: 'índice',
        level: 'ok',
        detail: `${manifest.fingerprint} — ${files} ficheros, ${chunks} chunks`,
      });
    }
  } catch (err) {
    checks.push({
      name: 'índice',
      level: 'error',
      detail: err instanceof Error ? err.message : String(err),
      fix: `Borra ${path.join(rootDir, '.karajan')} y reindexa: karajan-rag index ${rootDir}`,
    });
  }

  return checks;
}

/**
 * Ejecuta el subcomando `doctor` imprimiendo el reporte.
 *
 * @param {string[]} argv
 * @param {{ out?: (msg: string) => void, deps?: DoctorDeps }} [io]
 * @returns {Promise<{ checks: DoctorCheck[], errors: number, warnings: number }>}
 */
export async function runDoctorCommand(argv, io = {}) {
  const out = io.out ?? ((msg) => console.log(msg));
  const rootDir = path.resolve(argv[0] ?? '.');
  const checks = await runDoctorChecks(rootDir, io.deps);

  const ICONS = { ok: '✓', warn: '⚠', error: '✗' };
  out(`doctor: ${rootDir}`);
  for (const check of checks) {
    out(`  ${ICONS[check.level]} ${check.name}: ${check.detail}`);
    if (check.fix) out(`      fix: ${check.fix}`);
  }
  const errors = checks.filter((c) => c.level === 'error').length;
  const warnings = checks.filter((c) => c.level === 'warn').length;
  out(`doctor: ${errors} errores, ${warnings} avisos`);
  return { checks, errors, warnings };
}
