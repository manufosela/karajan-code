// @ts-check
/**
 * `karajan-rag report-issue` (KJR-TSK-0140) — el patrón kj report-issue
 * adaptado: cualquier usuario (o su agente) reporta una fricción al repo
 * público sin relay humano.
 *
 * Una issue pública es una FRONTERA DE PRIVACIDAD. El saneado colapsa
 * rutas home y pasa todo por redactPII (emails, teléfonos, NIF/NIE,
 * tarjetas, IBAN — el mismo redactor del pipeline). El composer solo
 * incluye lo que se pasó explícitamente (título, descripción, comando,
 * error) más metadatos de versión/entorno — nunca código del proyecto.
 * Publicar es decisión humana por defecto (preview + URL prefabricada);
 * `--publish` usa el CLI de gh.
 */
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { redactPII } from '../redaction/pii-redactor.js';

export const ISSUES_REPO = 'manufosela/karajan-rag';

const execFileAsync = promisify(execFile);

/**
 * Saneado de frontera: rutas home → `~`, después redactPII completo.
 * El texto devuelto queda NFKC-normalizado (efecto documentado del redactor).
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeForIssue(text) {
  const collapsed = String(text ?? '').replaceAll(/\/(?:home|Users)\/[^/\s]+/g, '~');
  return redactPII(collapsed).text;
}

/**
 * Compone la issue saneada. Solo viaja lo pasado explícitamente + entorno.
 *
 * @param {{ title: string, description?: string, command?: string, error?: string, env?: { version?: string, nodeVersion?: string, platform?: string } }} params
 * @returns {{ title: string, body: string }}
 */
export function composeIssue({ title, description = '', command = '', error = '', env = {} }) {
  const body = [
    sanitizeForIssue(description),
    command ? `\n**Command:** \`${sanitizeForIssue(command)}\`` : '',
    error ? `\n**Error:**\n\`\`\`\n${sanitizeForIssue(error)}\n\`\`\`` : '',
    '\n**Environment:**',
    `- karajan-rag ${env.version ?? 'unknown'}`,
    `- node ${env.nodeVersion ?? 'unknown'}`,
    `- ${env.platform ?? 'unknown'}`,
    '\n---',
    '_Reported via `karajan-rag report-issue` (sanitized: no project code, paths or personal data)._',
  ].filter(Boolean).join('\n');
  return { title: sanitizeForIssue(title), body };
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'from', 'with', 'for', 'and', 'not',
  'una', 'unos', 'con', 'para', 'que', 'los', 'las', 'del', 'karajan', 'rag',
]);

/** @param {string} title */
function meaningfulWords(title) {
  return title.toLowerCase().split(/[^a-z0-9á-úñ-]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

/**
 * Issues abiertas con títulos que comparten palabras significativas
 * (≥2 solapes, o 1 si el título es corto). API pública sin auth; CUALQUIER
 * fallo degrada a []: el dedup jamás bloquea el reporte.
 *
 * @param {string} title
 * @param {{ fetchFn?: typeof fetch }} [deps]
 * @returns {Promise<{ number: number, title: string, html_url: string }[]>}
 */
export async function findSimilarIssues(title, deps = {}) {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  try {
    const res = await fetchFn(
      `https://api.github.com/repos/${ISSUES_REPO}/issues?state=open&per_page=100`,
      { headers: { accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return [];
    const issues = await res.json();
    const words = meaningfulWords(title);
    const needed = Math.min(2, Math.max(1, words.length));
    return issues
      .filter((/** @type {{ title?: string }} */ issue) => {
        const theirs = new Set(meaningfulWords(issue.title ?? ''));
        return words.filter((w) => theirs.has(w)).length >= needed;
      })
      .map((/** @type {{ number: number, title: string, html_url: string }} */ i) => ({
        number: i.number, title: i.title, html_url: i.html_url,
      }));
  } catch {
    return [];
  }
}

/**
 * URL de nueva issue prefabricada — publicar sigue siendo un click humano.
 *
 * @param {{ title: string, body: string }} issue
 * @returns {string}
 */
export function newIssueUrl({ title, body }) {
  const params = new URLSearchParams({ title, body });
  return `https://github.com/${ISSUES_REPO}/issues/new?${params.toString().replaceAll('+', '%20')}`;
}

async function packageVersion() {
  try {
    const pkg = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

/**
 * Ejecuta el subcomando `report-issue`.
 *
 * Flags: --title (obligatorio), --description, --command, --error,
 * --publish (vía gh, confirmar con el humano antes), --force (ignora
 * duplicados), --json (salida para agentes).
 *
 * @param {string[]} argv
 * @param {{ out?: (msg: string) => void, fetchFn?: typeof fetch, runCmd?: (bin: string, args: string[]) => Promise<{ exitCode: number, stdout: string, stderr: string }> }} [io]
 * @returns {Promise<{ published: boolean, blockedByDuplicates: boolean, title: string, body: string, url: string, similar: { number: number, title: string, html_url: string }[] }>}
 */
export async function runReportIssueCommand(argv, io = {}) {
  const out = io.out ?? ((msg) => console.log(msg));
  const runCmd = io.runCmd ?? (async (bin, args) => {
    try {
      const { stdout, stderr } = await execFileAsync(bin, args);
      return { exitCode: 0, stdout, stderr };
    } catch (err) {
      const e = /** @type {{ code?: number, stdout?: string, stderr?: string, message: string }} */ (err);
      return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message };
    }
  });

  const { values } = parseArgs({
    args: argv,
    options: {
      title: { type: 'string' },
      description: { type: 'string' },
      command: { type: 'string' },
      error: { type: 'string' },
      publish: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });
  if (!values.title || !values.title.trim()) {
    throw new Error('report-issue: falta --title "<resumen en una línea>".');
  }

  const composed = composeIssue({
    title: values.title,
    description: values.description ?? '',
    command: values.command ?? '',
    error: values.error ?? '',
    env: {
      version: await packageVersion(),
      nodeVersion: process.version,
      platform: `${os.platform()}-${os.arch()}`,
    },
  });
  const url = newIssueUrl(composed);
  const similar = await findSimilarIssues(composed.title, { fetchFn: io.fetchFn });

  if (similar.length > 0 && !values.force) {
    const res = { published: false, blockedByDuplicates: true, ...composed, url, similar };
    if (values.json) out(JSON.stringify(res));
    else {
      out(`✗ ${similar.length} issue(s) abiertas parecidas — comenta allí en vez de duplicar (o repite con --force):`);
      for (const s of similar) out(`  #${s.number} ${s.title}\n     ${s.html_url}`);
    }
    return res;
  }

  if (values.publish) {
    const gh = await runCmd('gh', [
      'issue', 'create', '--repo', ISSUES_REPO, '--title', composed.title, '--body', composed.body,
    ]);
    if (gh.exitCode !== 0) {
      const res = { published: false, blockedByDuplicates: false, ...composed, url, similar };
      if (values.json) out(JSON.stringify({ ...res, error: gh.stderr.trim() }));
      else out(`✗ no se pudo publicar vía gh (${gh.stderr.trim()}) — ábrela a mano:\n${url}`);
      return res;
    }
    const issueUrl = gh.stdout.trim().split('\n').pop() ?? url;
    const res = { published: true, blockedByDuplicates: false, ...composed, url: issueUrl, similar };
    if (values.json) out(JSON.stringify(res));
    else out(`✓ issue publicada: ${issueUrl}`);
    return res;
  }

  const res = { published: false, blockedByDuplicates: false, ...composed, url, similar };
  if (values.json) out(JSON.stringify(res));
  else {
    out(`--- issue preview (saneada) ---\n# ${composed.title}\n\n${composed.body}\n---`);
    out(`Ábrela (y edítala) aquí:\n${url}`);
    out('O publica directamente con --publish (requiere gh; confírmalo antes con tu usuario).');
  }
  return res;
}
