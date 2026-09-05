// @ts-check
// KJW-TSK-0043 — la config también caduca: un repo observado sin un solo
// merge en meses es ruido que nadie señala (caso real: 13 de 29 repos de
// una instancia, descubierto a mano). Watch lo AVISA: propone retirar o
// confirmar, nunca decide ni bloquea. Filosofía Steward: la historia que no
// se puede leer no es «inactiva» — es no observable, y se dice aparte.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} InactiveRepo
 * @property {string} repo
 * @property {string | null} lastActivity Fecha ISO del último commit conocido; null sin commits.
 * @property {number | null} inactiveDays Días desde la última actividad; null cuando no consta actividad alguna.
 *
 * @typedef {Object} InactivityResult
 * @property {InactiveRepo[]} inactive Repos legibles cuya última actividad supera el umbral.
 * @property {string[]} unreadable Repos cuya historia no se pudo leer — no observables, jamás acusados de inactivos.
 */

/**
 * Clasifica los repos observados por frescura de su historia.
 *
 * @param {Object} params
 * @param {Array<{name: string, commits: Array<{date: string}>, readable?: boolean}>} params.repos
 * @param {number} [params.thresholdDays] Umbral de inactividad (default 90).
 * @param {string} params.now Instante de referencia (ISO) — inyectado para que el resultado sea determinista.
 * @returns {InactivityResult}
 */
export const findInactiveRepos = ({ repos, thresholdDays = 90, now }) => {
  const nowMs = Date.parse(now);
  /** @type {InactiveRepo[]} */
  const inactive = [];
  /** @type {string[]} */
  const unreadable = [];
  for (const repo of repos) {
    if (repo.readable === false) {
      unreadable.push(repo.name);
      continue;
    }
    const lastMs = repo.commits.reduce((max, c) => Math.max(max, Date.parse(c.date)), 0);
    if (lastMs === 0) {
      // Legible y sin un solo commit conocido: inactivo sin fecha.
      inactive.push({ repo: repo.name, lastActivity: null, inactiveDays: null });
      continue;
    }
    const inactiveDays = Math.floor((nowMs - lastMs) / MS_PER_DAY);
    if (inactiveDays > thresholdDays) {
      inactive.push({
        repo: repo.name,
        // La fecha original del commit, no una re-serialización.
        lastActivity: repo.commits.find((c) => Date.parse(c.date) === lastMs)?.date ?? null,
        inactiveDays,
      });
    }
  }
  return { inactive, unreadable };
};
