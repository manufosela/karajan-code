// @ts-check
/**
 * KJR-TSK-0162 — `karajan-rag init --claude`: using the index from an agent becomes one command,
 * the way `kj env install` is. The MCP server is registered in Claude Code and CLAUDE.md gains the
 * rule to consult the RAG before assuming, between markers so a second run replaces, never piles.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

export const BLOCK_START = '<!-- karajan-rag:start -->';
export const BLOCK_END = '<!-- karajan-rag:end -->';
const CLAUDE_MD = 'CLAUDE.md';

const execFileAsync = promisify(execFile);
/** @type {(bin: string, args: string[]) => Promise<unknown>} */
const defaultRun = (bin, args) => execFileAsync(bin, args);

/** POSIX quoting for the command handed to the user: a path with spaces pastes as one argument. */
const shellQuote = (s) => (/^[A-Za-z0-9_./:@%+=-]+$/.test(s) ? s : `'${s.replaceAll("'", String.raw`'\''`)}'`);

/** One server per folder: `rag-<folder>-<6 hex of the full path>`, so `a/docs` and `b/docs` never share one. */
export function serverNameFor(rootDir) {
  const full = path.resolve(rootDir);
  const base = path.basename(full).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
  return `rag-${base || 'root'}-${createHash('sha1').update(full).digest('hex').slice(0, 6)}`;
}

/** The rule the agent reads: which server, which tools, over which folder. */
export function claudeMdBlock({ serverName, rootDir }) {
  return [
    BLOCK_START,
    `## Knowledge base: ${serverName} (karajan-rag)`,
    '',
    `The folder \`${rootDir}\` is indexed and served by the MCP server \`${serverName}\`.`,
    'Before assuming what it says, ask it: `rag_query` answers with the passages and their source,',
    '`rag_status` says what is indexed. Never guess what a document contains when the index can tell.',
    BLOCK_END,
  ].join('\n');
}

/** Replaces the block between the markers, or appends it once; the rest of the file is untouched. */
export function upsertBlock(source, block) {
  const start = source.indexOf(BLOCK_START);
  const end = source.indexOf(BLOCK_END);
  if (start !== -1 && end !== -1 && end > start) {
    return `${source.slice(0, start)}${block}${source.slice(end + BLOCK_END.length)}`;
  }
  if (source.length === 0) return `${block}\n`;
  return `${source.endsWith('\n') ? source : `${source}\n`}\n${block}\n`;
}

/** @returns {Promise<{ path: string, action: 'created' | 'updated' | 'unchanged' }>} */
export async function writeClaudeMd(rootDir, { serverName }) {
  const file = path.join(rootDir, CLAUDE_MD);
  const current = await readFile(file, 'utf8').catch((err) => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
  const next = upsertBlock(current ?? '', claudeMdBlock({ serverName, rootDir }));
  if (current === next) return { path: file, action: 'unchanged' };
  await writeFile(file, next, 'utf8');
  return { path: file, action: current === null ? 'created' : 'updated' };
}

/**
 * `claude mcp add <server> -- karajan-rag serve <rootDir>`. Without `claude` on the PATH the
 * command is handed back for the user to run; any other failure is theirs to see.
 * @param {{ rootDir: string, serverName: string, run?: typeof defaultRun }} opts
 */
export async function registerClaudeMcp({ rootDir, serverName, run = defaultRun }) {
  const args = ['mcp', 'add', serverName, '--', 'karajan-rag', 'serve', rootDir];
  const command = ['claude', ...args].map(shellQuote).join(' ');
  try {
    await run('claude', args);
    return { registered: true, command };
  } catch (err) {
    if (/** @type {{ code?: string }} */ (err).code !== 'ENOENT') throw err;
    return { registered: false, reason: 'claude is not on the PATH', command };
  }
}

/**
 * Registers the server and writes the rule, saying what it did.
 * @param {{ rootDir: string, log: (msg: string) => void, run?: typeof defaultRun }} opts
 */
export async function setupClaude({ rootDir, log, run }) {
  const serverName = serverNameFor(rootDir);
  const mcp = await registerClaudeMcp({ rootDir, serverName, run });
  if (mcp.registered) log(`MCP registrado en Claude Code: ${mcp.command}`);
  else log(`${mcp.reason}: registra el MCP cuando lo tengas con  ${mcp.command}`);
  const claudeMd = await writeClaudeMd(rootDir, { serverName });
  log(`${CLAUDE_MD} ${claudeMd.action === 'unchanged' ? 'ya tenía' : 'tiene'} la regla de consultar ${serverName} antes de asumir (${claudeMd.action})`);
  return { serverName, registered: mcp.registered, command: mcp.command, claudeMd };
}
