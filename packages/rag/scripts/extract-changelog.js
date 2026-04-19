#!/usr/bin/env node
// @ts-check

/**
 * Extrae las notas de una versión concreta desde CHANGELOG.md
 * y las imprime por stdout. Usado por el workflow de release para
 * alimentar el body del GitHub Release.
 *
 * Uso:
 *   node scripts/extract-changelog.js 0.1.0
 *
 * Acepta también formato "v0.1.0" (se normaliza).
 * Sale con código 1 si no encuentra la sección.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * @param {string} changelog
 * @param {string} version - sin prefijo "v"
 * @returns {string|null}
 */
export function extractVersionNotes(changelog, version) {
  const clean = version.startsWith('v') ? version.slice(1) : version;
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = new RegExp(`^##\\s*\\[${escaped}\\][^\\n]*$`, 'm');
  const match = header.exec(changelog);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = changelog.slice(start);
  const nextHeader = /^##\s+\[/m.exec(rest);
  const refBlock = /^\[[^\]]+\]:\s+\S+/m.exec(rest);
  const stops = [nextHeader?.index, refBlock?.index].filter((i) => typeof i === 'number');
  const cutoff = stops.length > 0 ? Math.min(...stops) : rest.length;
  const body = rest.slice(0, cutoff);
  const trimmed = body.replace(/^\s*\n/, '').replace(/\s+$/, '');
  return trimmed.length > 0 ? trimmed : null;
}

async function main() {
  const rawVersion = process.argv[2];
  if (!rawVersion) {
    process.stderr.write('Usage: extract-changelog.js <version>\n');
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const changelogPath = resolve(here, '..', 'CHANGELOG.md');
  const changelog = await readFile(changelogPath, 'utf8');
  const notes = extractVersionNotes(changelog, rawVersion);

  if (!notes) {
    process.stderr.write(`No se encontraron notas para la versión ${rawVersion}\n`);
    process.exit(1);
  }

  process.stdout.write(notes + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}
