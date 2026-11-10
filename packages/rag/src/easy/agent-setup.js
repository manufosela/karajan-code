// @ts-check
/**
 * KJR-TSK-0162 — `karajan-rag init --claude`: using the index from an agent becomes one command,
 * the way `kj env install` is. The MCP server is registered in Claude Code and AGENTS.md gains the
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
const AGENTS_MD = 'AGENTS.md';

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

/** The source without the block between the markers (and the blank line kj put before it). */
export function removeBlock(source) {
  const start = source.indexOf(BLOCK_START);
  const end = source.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) return source;
  const before = source.slice(0, start).replace(/\n+$/, '\n');
  const after = source.slice(end + BLOCK_END.length).replace(/^\n+/, '');
  return `${before === '\n' ? '' : before}${after}`;
}

/** The file's text, or null when it does not exist. */
const readIfThere = (file) => readFile(file, 'utf8').catch((err) => {
  if (err.code === 'ENOENT') return null;
  throw err;
});

/** Drops the block from AGENTS.md when it is there, leaving the rest of the file. */
async function moveOutOfAgentsMd(rootDir) {
  const file = path.join(rootDir, AGENTS_MD);
  const agents = await readIfThere(file);
  if (agents === null) return;
  const without = removeBlock(agents);
  if (without !== agents) await writeFile(file, without, 'utf8');
}

/**
 * KJR-TSK-0164 (KJC-TSK-1504): the rule goes to AGENTS.md, the one rules file of the Karajan
 * family. A folder that keeps a CLAUDE.md gets it there instead: Claude Code reads that file and
 * not AGENTS.md when both exist, so writing AGENTS.md would leave the rule unread.
 * @returns {Promise<{ path: string, file: string, action: 'created' | 'updated' | 'unchanged' }>}
 */
export async function writeClaudeMd(rootDir, { serverName }) {
  const claude = await readIfThere(path.join(rootDir, CLAUDE_MD));
  const name = claude === null ? AGENTS_MD : CLAUDE_MD;
  const file = path.join(rootDir, name);
  const current = claude ?? await readIfThere(file);
  // A CLAUDE.md added after the block went to AGENTS.md takes it over: one block, in the file read.
  if (claude !== null) await moveOutOfAgentsMd(rootDir);
  const next = upsertBlock(current ?? '', claudeMdBlock({ serverName, rootDir }));
  if (current === next) return { path: file, file: name, action: 'unchanged' };
  await writeFile(file, next, 'utf8');
  return { path: file, file: name, action: current === null ? 'created' : 'updated' };
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
  log(`${claudeMd.file} ${claudeMd.action === 'unchanged' ? 'ya tenía' : 'tiene'} la regla de consultar ${serverName} antes de asumir (${claudeMd.action})`);
  return { serverName, registered: mcp.registered, command: mcp.command, claudeMd };
}
