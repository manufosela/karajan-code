// KJL-TSK-0158 (ADR 0052): copies the kj stage scene from the board into the
// landing at deploy time, so the factory page always shows the scene of the main
// it is deployed from and git never keeps a second copy.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The board's own starter (token, project in the URL, map) and the three bundle the landing already serves. */
export const BOARD_ONLY = ['main.js', 'map.js', 'token.js', 'three.min.js'];

const sceneFiles = (stage) => readdirSync(stage, { recursive: true })
  .filter((f) => f.endsWith('.js') && !BOARD_ONLY.includes(f))
  .toSorted();

/**
 * Copies <board>/stage into <to>/stage-<hash>/ with stage.css (the style block of
 * <board>/stage.html), drops any older copy and writes <to>/stage.json naming the folder.
 */
export function copyStage({ board, to }) {
  const stage = join(board, 'stage');
  const page = join(board, 'stage.html');
  if (!existsSync(stage) || !existsSync(page)) throw new Error(`copy-stage: no kj stage scene in ${board}`);
  const style = readFileSync(page, 'utf8').match(/<style>([\s\S]*?)<\/style>/)?.[1];
  if (!style) throw new Error(`copy-stage: ${page} has no style block for the scene's labels`);
  const files = sceneFiles(stage);
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update('\0').update(readFileSync(join(stage, file))).update('\0');
  hash.update(style);
  const dir = `stage-${hash.digest('hex').slice(0, 10)}`;

  mkdirSync(to, { recursive: true });
  for (const old of readdirSync(to).filter((f) => f.startsWith('stage-') && f !== dir)) rmSync(join(to, old), { recursive: true });
  for (const file of files) {
    mkdirSync(dirname(join(to, dir, file)), { recursive: true });
    cpSync(join(stage, file), join(to, dir, file));
  }
  writeFileSync(join(to, dir, 'stage.css'), `${style.trim()}\n`);
  writeFileSync(join(to, 'stage.json'), `${JSON.stringify({ dir })}\n`);
  return { dir };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const landing = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  // A folder of your own (a local preview) instead of public/factory.
  const to = process.argv[2] ? resolve(process.argv[2]) : join(landing, 'public', 'factory');
  const { dir } = copyStage({ board: resolve(landing, '../../packages/hu-board/public'), to });
  console.log(`copy-stage: ${join(to, dir)}`);
}
