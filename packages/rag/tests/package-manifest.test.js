// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = resolve(HERE, '..', 'package.json');

async function loadPackageJson() {
  const raw = await readFile(PKG_PATH, 'utf8');
  return JSON.parse(raw);
}

const REQUIRED_FILES = [
  'bin/',
  'src/',
  'migrations/',
  'index.js',
  'README.md',
  'CHANGELOG.md',
  'ROADMAP.md',
  'SECURITY.md',
  'LICENSE',
];

const FORBIDDEN_PATTERNS = [
  /^tests\/?/i,
  /^examples\/?/i,
  /^scripts\/?/i,
  /^\.github\/?/i,
  /^docs\/?/i,
  /^docker-compose\.ya?ml$/i,
  /^eslint\.config\.js$/i,
  /^\.editorconfig$/i,
  /^\.gitattributes$/i,
  /^\.nvmrc$/i,
  /^\.c8rc\.json$/i,
];

test('package.json: "files" existe y no está vacío', async () => {
  const pkg = await loadPackageJson();
  assert.ok(Array.isArray(pkg.files), '"files" debe ser array');
  assert.ok(pkg.files.length > 0, '"files" no debe estar vacío');
});

test('package.json: "files" incluye el contenido runtime y docs canónicos', async () => {
  const pkg = await loadPackageJson();
  for (const entry of REQUIRED_FILES) {
    assert.ok(
      pkg.files.includes(entry),
      `"files" debe incluir ${entry}. Actual: ${JSON.stringify(pkg.files)}`,
    );
  }
});

test('package.json: "files" no incluye carpetas/ficheros de dev ni CI', async () => {
  const pkg = await loadPackageJson();
  for (const entry of pkg.files) {
    for (const forbidden of FORBIDDEN_PATTERNS) {
      assert.ok(
        !forbidden.test(entry),
        `"files" no debe incluir "${entry}" (coincide con ${forbidden}). Eso se publicaría en npm.`,
      );
    }
  }
});

test('package.json: metadata básica está presente', async () => {
  const pkg = await loadPackageJson();
  assert.equal(pkg.name, 'karajan-rag');
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.license);
  assert.ok(pkg.repository?.url?.includes('karajan-rag'));
  assert.ok(pkg.engines?.node);
  assert.ok(pkg.bin?.['karajan-rag']);
});

test('package.json: prepublishOnly ejecuta lint + tests', async () => {
  const pkg = await loadPackageJson();
  assert.ok(
    typeof pkg.scripts?.prepublishOnly === 'string',
    'scripts.prepublishOnly debe existir como red de seguridad pre-publish',
  );
  assert.match(pkg.scripts.prepublishOnly, /lint/);
  assert.match(pkg.scripts.prepublishOnly, /test/);
});
