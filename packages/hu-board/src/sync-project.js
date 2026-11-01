// KJC-TSK-0542: how the sync names a project (id, canonical dir, display titles).
// sync.js re-exports the public functions, so callers keep importing from there.
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';

/**
 * Derive a stable `project_id` from a plan's absolute `projectDir`.
 * Used so every plan under the same source tree groups under one project
 * on the board (instead of 1 project per plan — the 2 101-stories bug).
 *
 * @param {string} projectDir
 * @returns {string}
 */
export function deriveProjectIdFromDir(projectDir) {
  if (!projectDir || typeof projectDir !== 'string') return 'unknown';
  // Same slug rule the plan-store uses, so identifiers match if we ever
  // cross-reference `~/.kj/plans/<slug>/` with this project_id.
  return projectDir
    .replace(/^\//, '')
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 120);
}

/** git-common-dir del directorio, con el stderr silenciado (no-git = throw). */
const defaultGitCommonDir = (dir) =>
  execFileSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

const canonicalDirCache = new Map();

/**
 * Resolve a projectDir to the REPO's identity (KJC-BUG-0160): a linked
 * worktree (`.claude/worktrees/*`, kj lanes) used to register the same
 * repo as a brand-new project — 13+ same-named entries in a real picker.
 * `git rev-parse --git-common-dir` points every worktree at the main
 * tree's `.git`; its parent is the canonical root. A non-git directory
 * keeps its own path as identity, as always.
 *
 * @param {string} projectDir
 * @param {(dir: string) => string} [gitCommonDir] Inyectable en tests.
 * @returns {string}
 */
export function canonicalProjectDir(projectDir, gitCommonDir = defaultGitCommonDir) {
  if (!projectDir || typeof projectDir !== 'string') return projectDir;
  if (canonicalDirCache.has(projectDir)) return canonicalDirCache.get(projectDir);
  let canonical = projectDir;
  try {
    const common = gitCommonDir(projectDir);
    const absCommon = isAbsolute(common) ? common : resolvePath(projectDir, common);
    canonical = dirname(absCommon);
  } catch {
    // Sin git no hay más identidad que la ruta — comportamiento de siempre.
  }
  canonicalDirCache.set(projectDir, canonical);
  return canonical;
}

/**
 * Turn a directory basename into a human-friendly Title Case string,
 * preserving every meaningful word. Unlike `slugToTitle`, this one does
 * NOT apply stopword filtering — directory names are concise on purpose
 * (e.g. "linux-assistant-orchestrator" → "Linux Assistant Orchestrator",
 * "my-dev-tool" → "My Dev Tool").
 *
 * @param {string} name
 * @returns {string}
 */
export function titleCaseBasename(name) {
  const words = String(name || '')
    .replace(/[_\s]+/g, '-')
    .split('-')
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return String(name || '');
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

export function slugToTitle(text) {
  const STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'with', 'for', 'to', 'of', 'in', 'on',
    'is', 'it', 'its', 'this', 'that', 'these', 'those', 'be', 'been', 'being',
    'build', 'create', 'implement', 'make', 'develop', 'add', 'set', 'up',
    'setup', 'write', 'code', 'new', 'complete', 'from', 'scratch',
    'application', 'app', 'tool', 'system', 'project', 'using', 'use',
    'full', 'full-stack', 'fullstack', 'stack', 'based', 'simple', 'basic',
  ]);
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
  const meaningful = words.slice(0, 6);
  if (meaningful.length === 0) return String(text).slice(0, 60).trim();
  const titled = meaningful.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return titled.length > 60 ? titled.slice(0, 57) + '...' : titled;
}
