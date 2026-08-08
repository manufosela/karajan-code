// @ts-check
/**
 * Sincroniza la documentación de la familia Karajan desde sus repos
 * canónicos hacia el Starlight de este sitio (KJL-TSK-0112).
 *
 * - Descarga cada fuente de GitHub raw pinneada a un tag (`ref`).
 * - Parte el markdown en páginas por headings declarados en
 *   family-docs.config.mjs y escribe el locale `es/` (los docs fuente
 *   están en español): frontmatter + procedencia + sha256 de la sección.
 * - Las páginas EN (raíz) son traducciones mantenidas en ESTE repo: cada
 *   una declara `source-sha256` de la sección que traduce. Si la fuente
 *   cambió, el sync lo AVISA (y con `--check` falla), para que la
 *   traducción nunca quede obsoleta en silencio.
 *
 * Sin fallbacks silenciosos: heading ausente, fetch fallido o página EN
 * sin marca de procedencia → error con el dato exacto.
 *
 * Uso: node scripts/sync-family-docs.mjs [--check]
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sources } from './family-docs.config.mjs';

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkMode = process.argv.includes('--check');

const sha256 = (/** @type {string} */ text) =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/** Descarga un fichero raw del repo pinneado. */
async function fetchSource({ repo, ref, path: filePath }) {
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} → ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Parte el documento en secciones contiguas según los headings de inicio
 * declarados. Lanza si un heading no existe (la fuente cambió: hay que
 * resincronizar el config).
 */
function splitPages(markdown, pages, sourceLabel) {
  const lines = markdown.split('\n');
  const startIndexes = pages.map((page) => {
    if (page.start === null) return 0;
    const idx = lines.findIndex((line) => line.trim() === page.start);
    if (idx === -1) {
      throw new Error(
        `heading no encontrado en ${sourceLabel}: "${page.start}" — la fuente cambió; actualiza family-docs.config.mjs`,
      );
    }
    return idx;
  });
  const sorted = [...startIndexes].toSorted((a, b) => a - b);
  if (String(sorted) !== String(startIndexes)) {
    throw new Error(`las páginas de ${sourceLabel} no están en el orden del documento`);
  }
  return pages.map((page, i) => {
    const from = startIndexes[i];
    const to = startIndexes[i + 1] ?? lines.length;
    return { ...page, body: lines.slice(from, to).join('\n').trim() };
  });
}

/** Quita el heading inicial (pasa a ser el título de la página). */
function dropLeadingHeading(body) {
  const lines = body.split('\n');
  return /^#{1,4} /.test(lines[0] ?? '') ? lines.slice(1).join('\n').trim() : body;
}

/** Renormaliza headings para que el nivel mínimo sea H2 (título = frontmatter). */
function normalizeHeadings(body) {
  const headings = [...body.matchAll(/^(#{1,6}) /gm)].map((m) => m[1].length);
  if (headings.length === 0) return body;
  const min = Math.min(...headings);
  const shift = 2 - min;
  if (shift === 0) return body;
  return body.replaceAll(/^(#{1,6}) /gm, (_, hashes) => `${'#'.repeat(hashes.length + shift)} `);
}

/** Reescribe enlaces markdown relativos hacia el blob del repo pinneado. */
function absolutizeLinks(body, { repo, ref, path: filePath }) {
  const baseDir = path.posix.dirname(filePath);
  return body.replaceAll(/\]\((\.{1,2}\/[^)#\s]+)(#[^)\s]*)?\)/g, (_, rel, anchor = '') => {
    const resolved = path.posix.normalize(path.posix.join(baseDir, rel));
    return `](https://github.com/${repo}/blob/${ref}/${resolved}${anchor})`;
  });
}

function frontmatter({ title, description }) {
  const esc = (/** @type {string} */ v) => v.replaceAll("'", "''");
  return `---\ntitle: '${esc(title)}'\ndescription: '${esc(description)}'\n---`;
}

const warnings = [];

for (const source of sources) {
  const label = `${source.repo}@${source.ref}:${source.path}`;
  const markdown = await fetchSource(source);
  const pages = splitPages(markdown, source.pages, label);
  const outDir = path.join(docsRoot, source.outDir);
  await mkdir(outDir, { recursive: true });

  for (const page of pages) {
    const content = normalizeHeadings(
      absolutizeLinks(dropLeadingHeading(page.body), source),
    );
    const hash = sha256(content);
    const banner =
      `<!-- synced-from: ${label} · section-sha256: ${hash}\n` +
      '     NO EDITAR A MANO — regenerado con `npm run sync:family-docs` -->';
    await writeFile(
      path.join(outDir, `${page.slug}.md`),
      `${frontmatter(page)}\n\n${banner}\n\n${content}\n`,
      'utf8',
    );

    // Frescura de la traducción EN: debe declarar el sha256 de la sección.
    const enPath = path.join(docsRoot, source.translationDir, `${page.slug}.md`);
    if (!existsSync(enPath)) {
      warnings.push(`EN ausente: ${source.translationDir}/${page.slug}.md (traducir desde ${label})`);
      continue;
    }
    const enContent = await readFile(enPath, 'utf8');
    const declared = enContent.match(/source-sha256: ([0-9a-f]{64})/)?.[1];
    if (declared === undefined) {
      throw new Error(`la página EN ${page.slug}.md no declara source-sha256 — añade su marca de procedencia`);
    }
    if (declared !== hash) {
      warnings.push(
        `EN obsoleta: karagan/${page.slug}.md traduce ${declared.slice(0, 12)}… pero la fuente es ${hash.slice(0, 12)}… — retraducir y actualizar la marca`,
      );
    }
  }
  console.log(`✓ ${label} → ${source.pages.length} páginas en ${source.outDir}`);
}

if (warnings.length > 0) {
  console.warn(`\n⚠ ${warnings.length} aviso(s) de traducción:\n- ${warnings.join('\n- ')}`);
  if (checkMode) process.exit(1);
}
