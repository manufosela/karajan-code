// @ts-check
/**
 * F2 — minero de co-cambios git entre repos.
 *
 * Señal barata e independiente del contenido: cuando históricamente se
 * tocó el área X del repo origen, ¿qué se tocó en cada repo destino en
 * ventanas temporales cercanas? Complementa al retrieval semántico.
 *
 * Dos capas: `correlateCoChanges` (lógica pura sobre historiales ya
 * leídos) y `readRepoHistory` (lector `git log` con exec inyectable).
 * Honestidad primero: un repo sin historial aparece como `noSignal` con
 * motivo — nunca como un cero silencioso indistinguible de "sin riesgo".
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Error del minero de co-cambios. */
export class CoChangeError extends Error {
  /**
   * @param {string} message
   * @param {{cause?: unknown}} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'CoChangeError';
  }
}

/**
 * @typedef {Object} RepoCommit
 * @property {string} hash
 * @property {string} date Fecha ISO del commit.
 * @property {string[]} files Paths tocados, relativos a la raíz del repo.
 *
 * @typedef {Object} RepoHistory
 * @property {string} name
 * @property {RepoCommit[]} commits
 *
 * @typedef {Object} CoChange
 * @property {string} path Path del repo destino que co-cambió.
 * @property {number} count Nº de ventanas del origen en las que apareció.
 * @property {string} lastDate Fecha ISO del co-cambio más reciente.
 *
 * @typedef {Object} RepoCoChanges
 * @property {string} repo
 * @property {CoChange[]} coChanges Ordenados por count desc (empate: fecha más reciente).
 *
 * @typedef {Object} NoSignalRepo
 * @property {string} repo
 * @property {string} reason
 *
 * @typedef {Object} CoChangeResult
 * @property {RepoCoChanges[]} byRepo
 * @property {NoSignalRepo[]} noSignal
 */

/**
 * Correlaciona co-cambios: commits del origen que tocaron las áreas dadas
 * contra commits de cada destino dentro de ±windowHours.
 *
 * @param {Object} params
 * @param {RepoHistory} params.origin
 * @param {RepoHistory[]} params.targets
 * @param {string[]} params.touchedPaths Paths del repo origen cuya historia define las ventanas.
 * @param {number} [params.windowHours]
 * @returns {CoChangeResult}
 */
export const correlateCoChanges = ({ origin, targets, touchedPaths, windowHours = 48 }) => {
  if (!Array.isArray(touchedPaths) || touchedPaths.length === 0) {
    throw new CoChangeError('touchedPaths vacío: no hay área del repo origen que correlar.');
  }
  const touched = new Set(touchedPaths);
  const windowMs = windowHours * 60 * 60 * 1000;

  const areaTimestamps = origin.commits
    .filter((c) => c.files.some((f) => touched.has(f)))
    .map((c) => Date.parse(c.date));

  /** @type {RepoCoChanges[]} */
  const byRepo = [];
  /** @type {NoSignalRepo[]} */
  const noSignal = [];

  for (const target of targets) {
    if (target.commits.length === 0) {
      noSignal.push({ repo: target.name, reason: 'sin historial git disponible.' });
      continue;
    }
    if (areaTimestamps.length === 0) {
      noSignal.push({
        repo: target.name,
        reason: 'el origen no tiene commits del área tocada: sin ventanas que correlar.',
      });
      continue;
    }

    // El count es "en cuántas ventanas del origen apareció el path":
    // varios commits del destino dentro de la misma ventana cuentan una
    // sola vez — si no, un burst de commits inflaría la correlación.
    /** @type {Map<string, {count: number, lastDate: string}>} */
    const counts = new Map();
    for (const windowTime of areaTimestamps) {
      /** @type {Map<string, string>} */
      const filesInWindow = new Map();
      for (const targetCommit of target.commits) {
        if (Math.abs(Date.parse(targetCommit.date) - windowTime) > windowMs) continue;
        for (const file of targetCommit.files) {
          const prev = filesInWindow.get(file);
          if (!prev || Date.parse(targetCommit.date) > Date.parse(prev)) {
            filesInWindow.set(file, targetCommit.date);
          }
        }
      }
      for (const [file, date] of filesInWindow) {
        const entry = counts.get(file);
        if (entry) {
          entry.count += 1;
          if (Date.parse(date) > Date.parse(entry.lastDate)) entry.lastDate = date;
        } else {
          counts.set(file, { count: 1, lastDate: date });
        }
      }
    }

    byRepo.push({
      repo: target.name,
      coChanges: [...counts.entries()]
        .map(([path, { count, lastDate }]) => ({ path, count, lastDate }))
        .toSorted(
          (a, b) => b.count - a.count || Date.parse(b.lastDate) - Date.parse(a.lastDate),
        ),
    });
  }

  return { byRepo, noSignal };
};

const LOG_FORMAT = '%x1e%H%x1f%cI';

/**
 * Lee el historial de un repo con `git log --name-only`.
 *
 * @param {string} repoDir
 * @param {{exec?: typeof execFileAsync, maxCommits?: number}} [options]
 * @returns {Promise<RepoCommit[]>} Commits en orden cronológico ascendente.
 */
export const readRepoHistory = async (repoDir, options = {}) => {
  const exec = options.exec ?? execFileAsync;
  const maxCommits = options.maxCommits ?? 500;
  let stdout;
  try {
    ({ stdout } = await exec('git', [
      '-C',
      repoDir,
      'log',
      `--max-count=${maxCommits}`,
      '--name-only',
      `--pretty=format:${LOG_FORMAT}`,
    ]));
  } catch (err) {
    throw new CoChangeError(`no se pudo leer el historial git de "${repoDir}".`, { cause: err });
  }

  /** @type {RepoCommit[]} */
  const commits = [];
  for (const record of stdout.split('')) {
    const trimmed = record.trim();
    if (trimmed.length === 0) continue;
    const [header, ...fileLines] = trimmed.split('\n');
    const [hash, date] = header.split('');
    commits.push({
      hash,
      date,
      files: fileLines.map((l) => l.trim()).filter((l) => l.length > 0),
    });
  }
  return commits.toReversed();
};
