// @ts-check
/**
 * KJR-TSK-0140 — `karajan-rag report-issue`: una issue pública es una
 * frontera de privacidad. El saneado usa redactPII (más fuerte que el de
 * kj: emails, teléfonos, NIF/NIE, IBAN, tarjetas) + colapso de rutas
 * home; el dedup degrada a [] ante cualquier fallo; publicar es decisión
 * humana salvo --publish explícito.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeForIssue,
  composeIssue,
  findSimilarIssues,
  newIssueUrl,
  runReportIssueCommand,
  ISSUES_REPO,
} from '../src/support/issue-report.js';

test('sanitizeForIssue: colapsa rutas home y redacta PII', () => {
  const out = sanitizeForIssue(
    'Falla en /home/usuario1/proyecto y en /Users/otra.persona/code; escribe a persona@example.com o al 612 345 678',
  );
  assert.ok(!out.includes('/home/usuario1'), 'ruta linux colapsada');
  assert.ok(!out.includes('/Users/otra.persona'), 'ruta macOS colapsada');
  assert.ok(out.includes('~/proyecto'));
  assert.ok(!out.includes('persona@example.com'), 'email redactado');
  assert.ok(!out.includes('612 345 678'), 'teléfono redactado');
});

test('composeIssue: cuerpo con comando, error, entorno y pie de saneado', () => {
  const { title, body } = composeIssue({
    title: 'index falla en /home/yo/corpus',
    description: 'Al indexar peta.',
    command: 'karajan-rag index /home/yo/corpus',
    error: 'Error: boom en /home/yo/corpus/file.md',
    env: { version: '1.1.0', nodeVersion: 'v22.0.0', platform: 'linux-x64' },
  });
  assert.ok(!title.includes('/home/yo'), 'el título también se sanea');
  assert.ok(body.includes('**Command:**'));
  assert.ok(body.includes('karajan-rag 1.1.0'));
  assert.ok(body.includes('node v22.0.0'));
  assert.ok(body.includes('report-issue'));
  assert.ok(!body.includes('/home/yo'), 'ninguna ruta home sobrevive en el cuerpo');
});

test('findSimilarIssues: matchea por solape de palabras y degrada a [] ante fallos', async () => {
  const fakeIssues = [
    { number: 7, title: 'index fails with lancedb store', html_url: 'https://x/7' },
    { number: 9, title: 'docs typo', html_url: 'https://x/9' },
  ];
  const similar = await findSimilarIssues('index fails on my lancedb corpus', {
    fetchFn: async () => ({ ok: true, json: async () => fakeIssues }),
  });
  assert.equal(similar.length, 1);
  assert.equal(similar[0].number, 7);

  const broken = await findSimilarIssues('whatever title here', {
    fetchFn: async () => { throw new Error('red caída'); },
  });
  assert.deepEqual(broken, [], 'el dedup nunca bloquea el reporte');
});

test('newIssueUrl apunta al repo de karajan-rag con título y cuerpo', () => {
  const url = newIssueUrl({ title: 'Un bug', body: 'detalle' });
  assert.ok(url.startsWith(`https://github.com/${ISSUES_REPO}/issues/new?`));
  assert.ok(ISSUES_REPO.includes('karajan-rag'));
  assert.ok(url.includes('title=Un%20bug'));
});

test('runReportIssueCommand: sin --publish devuelve preview y URL, sin publicar', async () => {
  /** @type {string[]} */
  const out = [];
  const res = await runReportIssueCommand(
    ['--title', 'query devuelve vacío con transformers'],
    {
      out: (msg) => out.push(msg),
      fetchFn: async () => ({ ok: true, json: async () => [] }),
    },
  );
  assert.equal(res.published, false);
  assert.ok(res.url.includes('issues/new'));
  assert.ok(out.some((l) => l.includes('preview')));
});

test('runReportIssueCommand: issues similares bloquean salvo --force', async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => [{ number: 3, title: 'query devuelve vacío siempre', html_url: 'https://x/3' }],
  });
  const blocked = await runReportIssueCommand(
    ['--title', 'query devuelve vacío con hash'],
    { out: () => {}, fetchFn },
  );
  assert.equal(blocked.published, false);
  assert.equal(blocked.similar.length, 1);
  assert.equal(blocked.blockedByDuplicates, true);

  const forced = await runReportIssueCommand(
    ['--title', 'query devuelve vacío con hash', '--force'],
    { out: () => {}, fetchFn },
  );
  assert.equal(forced.blockedByDuplicates, false);
});

test('runReportIssueCommand: --publish usa gh y reporta la URL creada', async () => {
  /** @type {string[][]} */
  const calls = [];
  const res = await runReportIssueCommand(
    ['--title', 'doctor no detecta ollama', '--publish'],
    {
      out: () => {},
      fetchFn: async () => ({ ok: true, json: async () => [] }),
      runCmd: async (bin, args) => {
        calls.push([bin, ...args]);
        return { exitCode: 0, stdout: 'https://github.com/x/issues/42\n', stderr: '' };
      },
    },
  );
  assert.equal(res.published, true);
  assert.ok(res.url.includes('/issues/42'));
  assert.equal(calls[0][0], 'gh');
  assert.ok(calls[0].includes('--repo'));
});

test('runReportIssueCommand: sin --title falla con mensaje accionable', async () => {
  await assert.rejects(
    () => runReportIssueCommand([], { out: () => {} }),
    /--title/,
  );
});
