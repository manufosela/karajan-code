// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVersionNotes } from '../scripts/extract-changelog.js';

const SAMPLE = `# Changelog

## [Unreleased]

- cosas nuevas

## [0.2.0] — 2026-05-10

### Added
- feature B

### Fixed
- bug Y

## [0.1.0] — 2026-04-19

### Added
- feature A

### Fixed
- bug X

[Unreleased]: https://example.com
[0.2.0]: https://example.com
[0.1.0]: https://example.com
`;

test('extractVersionNotes: extrae sección de versión intermedia sin arrastrar siguiente', () => {
  const notes = extractVersionNotes(SAMPLE, '0.2.0');
  assert.ok(notes);
  assert.match(notes, /feature B/);
  assert.match(notes, /bug Y/);
  assert.doesNotMatch(notes, /feature A/);
  assert.doesNotMatch(notes, /bug X/);
});

test('extractVersionNotes: acepta prefijo "v" y lo normaliza', () => {
  const notes = extractVersionNotes(SAMPLE, 'v0.1.0');
  assert.ok(notes);
  assert.match(notes, /feature A/);
});

test('extractVersionNotes: última sección incluye contenido sin sección siguiente', () => {
  const notes = extractVersionNotes(SAMPLE, '0.1.0');
  assert.ok(notes);
  assert.match(notes, /feature A/);
  assert.match(notes, /bug X/);
  assert.doesNotMatch(notes, /feature B/);
  // No debe incluir las referencias al final.
  assert.doesNotMatch(notes, /\[Unreleased\]: https/);
});

test('extractVersionNotes: versión inexistente devuelve null', () => {
  const notes = extractVersionNotes(SAMPLE, '9.9.9');
  assert.equal(notes, null);
});

test('extractVersionNotes: no confunde 0.1.0 con 0.1.10', () => {
  const changelog = `## [0.1.10]\ncontent ten\n\n## [0.1.0]\ncontent zero\n`;
  const v0 = extractVersionNotes(changelog, '0.1.0');
  const v10 = extractVersionNotes(changelog, '0.1.10');
  assert.match(v0 ?? '', /content zero/);
  assert.doesNotMatch(v0 ?? '', /content ten/);
  assert.match(v10 ?? '', /content ten/);
  assert.doesNotMatch(v10 ?? '', /content zero/);
});

test('extractVersionNotes: sección vacía devuelve null', () => {
  const changelog = `## [0.0.1]\n\n## [0.0.2]\ncontent\n`;
  const empty = extractVersionNotes(changelog, '0.0.1');
  assert.equal(empty, null);
});
