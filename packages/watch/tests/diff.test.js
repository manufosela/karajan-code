// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiffError, parseUnifiedDiff } from '../src/diff.js';

const MODIFIED_TWO_HUNKS = `diff --git a/src/api.js b/src/api.js
index 1111111..2222222 100644
--- a/src/api.js
+++ b/src/api.js
@@ -10,7 +10,8 @@ export const listUsers = () => {
 const PAGE_SIZE = 20;
-const TIMEOUT_MS = 1000;
+const TIMEOUT_MS = 5000;
+const RETRIES = 2;
 export const fetchUsers = () => {
@@ -40,4 +41,4 @@ export const deleteUser = (id) => {
-  return client.del(\`/users/\${id}\`);
+  return client.delete(\`/users/\${id}\`);
 };
`;

const ADDED_FILE = `diff --git a/docs/notes.md b/docs/notes.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/docs/notes.md
@@ -0,0 +1,2 @@
+# Notas
+Primera línea.
`;

const DELETED_FILE = `diff --git a/src/legacy.js b/src/legacy.js
deleted file mode 100644
index 4444444..0000000
--- a/src/legacy.js
+++ /dev/null
@@ -1,2 +0,0 @@
-export const legacy = true;
-export default legacy;
`;

const RENAMED_WITH_CHANGES = `diff --git a/src/old-name.js b/src/new-name.js
similarity index 90%
rename from src/old-name.js
rename to src/new-name.js
index 5555555..6666666 100644
--- a/src/old-name.js
+++ b/src/new-name.js
@@ -1,3 +1,3 @@
-export const oldThing = 1;
+export const newThing = 1;
 export const stable = 2;
`;

const BINARY_FILE = `diff --git a/assets/logo.png b/assets/logo.png
index 7777777..8888888 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
`;

test('modificación con dos hunks: un chunk por hunk con líneas numeradas', () => {
  const chunks = parseUnifiedDiff(MODIFIED_TWO_HUNKS, { repoName: 'repo-a' });
  assert.equal(chunks.length, 2);

  const [first, second] = chunks;
  assert.equal(first.repo, 'repo-a');
  assert.equal(first.path, 'src/api.js');
  assert.equal(first.oldPath, 'src/api.js');
  assert.equal(first.changeType, 'modified');
  assert.equal(first.newStart, 10);
  assert.deepEqual(
    first.addedLines.map((l) => l.content),
    ['const TIMEOUT_MS = 5000;', 'const RETRIES = 2;'],
  );
  assert.deepEqual(first.addedLines.map((l) => l.line), [11, 12]);
  assert.deepEqual(
    first.removedLines.map((l) => l.content),
    ['const TIMEOUT_MS = 1000;'],
  );
  assert.ok(first.text.includes('TIMEOUT_MS = 5000'));
  assert.ok(first.text.includes('TIMEOUT_MS = 1000'));

  assert.equal(second.newStart, 41);
  assert.deepEqual(second.addedLines.map((l) => l.line), [41]);
});

test('fichero nuevo: changeType added y solo líneas añadidas', () => {
  const [chunk] = parseUnifiedDiff(ADDED_FILE, { repoName: 'repo-a' });
  assert.equal(chunk.changeType, 'added');
  assert.equal(chunk.path, 'docs/notes.md');
  assert.equal(chunk.oldPath, null);
  assert.equal(chunk.removedLines.length, 0);
  assert.equal(chunk.addedLines.length, 2);
});

test('fichero borrado: changeType deleted y solo líneas quitadas', () => {
  const [chunk] = parseUnifiedDiff(DELETED_FILE, { repoName: 'repo-a' });
  assert.equal(chunk.changeType, 'deleted');
  assert.equal(chunk.path, 'src/legacy.js');
  assert.equal(chunk.addedLines.length, 0);
  assert.equal(chunk.removedLines.length, 2);
});

test('rename con cambios: paths viejo y nuevo', () => {
  const [chunk] = parseUnifiedDiff(RENAMED_WITH_CHANGES, { repoName: 'repo-a' });
  assert.equal(chunk.changeType, 'renamed');
  assert.equal(chunk.path, 'src/new-name.js');
  assert.equal(chunk.oldPath, 'src/old-name.js');
  assert.equal(chunk.addedLines.length, 1);
  assert.equal(chunk.removedLines.length, 1);
});

test('binario: marcado sin hunks y sin romper', () => {
  const [chunk] = parseUnifiedDiff(BINARY_FILE, { repoName: 'repo-a' });
  assert.equal(chunk.changeType, 'binary');
  assert.equal(chunk.path, 'assets/logo.png');
  assert.equal(chunk.addedLines.length, 0);
  assert.equal(chunk.removedLines.length, 0);
  assert.equal(chunk.text, '');
});

test('varios ficheros en un diff: chunks de todos con su path', () => {
  const combined = `${MODIFIED_TWO_HUNKS}${ADDED_FILE}${BINARY_FILE}`;
  const chunks = parseUnifiedDiff(combined, { repoName: 'repo-a' });
  assert.equal(chunks.length, 4);
  assert.deepEqual(
    [...new Set(chunks.map((c) => c.path))],
    ['src/api.js', 'docs/notes.md', 'assets/logo.png'],
  );
});

test('diff vacío o ilegible: DiffError explícito, nunca lista vacía', () => {
  assert.throws(() => parseUnifiedDiff('', { repoName: 'r' }), DiffError);
  assert.throws(() => parseUnifiedDiff('   \n', { repoName: 'r' }), DiffError);
  assert.throws(
    () => parseUnifiedDiff('esto no es un diff de git', { repoName: 'r' }),
    (err) => err instanceof DiffError && err.message.includes('diff'),
  );
});

test('repoName requerido: string no vacío', () => {
  assert.throws(() => parseUnifiedDiff(MODIFIED_TWO_HUNKS, { repoName: '' }), DiffError);
  // @ts-expect-error — llamada sin opciones a propósito
  assert.throws(() => parseUnifiedDiff(MODIFIED_TWO_HUNKS), DiffError);
});
