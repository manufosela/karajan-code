// @ts-check
// KJR-TSK-0162: `karajan-rag init --claude` registers the MCP server in Claude Code and writes
// the consult-before-assuming rule into CLAUDE.md, idempotently, like `kj env install` does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BLOCK_START,
  BLOCK_END,
  claudeMdBlock,
  upsertBlock,
  writeClaudeMd,
  registerClaudeMcp,
  serverNameFor,
  setupClaude,
} from '../src/easy/agent-setup.js';

test('serverNameFor: one server per folder, a safe name, distinct for same-named folders', () => {
  assert.match(serverNameFor('/home/x/My Project.v2'), /^rag-my-project-v2-[0-9a-f]{6}$/);
  assert.match(serverNameFor('/'), /^rag-root-[0-9a-f]{6}$/);
  assert.notEqual(serverNameFor('/work/a/docs'), serverNameFor('/work/b/docs'));
});

test('upsertBlock: appends once, replaces between the markers, leaves the rest alone', () => {
  const block = `${BLOCK_START}\nrule A\n${BLOCK_END}`;
  const fresh = upsertBlock('', block);
  assert.equal(fresh, `${block}\n`);
  assert.equal(upsertBlock(fresh, block), fresh, 'idempotent');
  const mine = '# Mine\n\nkeep this\n';
  const once = upsertBlock(mine, block);
  assert.ok(once.startsWith(mine));
  assert.equal(once.split(BLOCK_START).length, 2);
  const replaced = upsertBlock(once, `${BLOCK_START}\nrule B\n${BLOCK_END}`);
  assert.ok(replaced.includes('rule B') && !replaced.includes('rule A'));
  assert.ok(replaced.startsWith(mine));
});

test('claudeMdBlock names the server and the tools, and tells the agent to ask before assuming', () => {
  const block = claudeMdBlock({ serverName: 'rag-docs', rootDir: '/x/docs' });
  assert.ok(block.startsWith(BLOCK_START) && block.endsWith(BLOCK_END));
  for (const needle of ['rag-docs', 'rag_query', 'rag_status', '/x/docs']) assert.ok(block.includes(needle), needle);
});

test('writeClaudeMd: creates, then reports unchanged, then updates when the block changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-agent-'));
  try {
    assert.equal((await writeClaudeMd(root, { serverName: 'rag-a' })).action, 'created');
    assert.equal((await writeClaudeMd(root, { serverName: 'rag-a' })).action, 'unchanged');
    await writeFile(path.join(root, 'CLAUDE.md'), `# Mine\n${await readFile(path.join(root, 'CLAUDE.md'), 'utf8')}`);
    assert.equal((await writeClaudeMd(root, { serverName: 'rag-b' })).action, 'updated');
    const text = await readFile(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.ok(text.startsWith('# Mine') && text.includes('rag-b') && !text.includes('rag-a'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('registerClaudeMcp: runs claude mcp add with the absolute serve command', async () => {
  /** @type {string[][]} */
  const calls = [];
  const run = async (/** @type {string} */ bin, /** @type {string[]} */ args) => { calls.push([bin, ...args]); return { stdout: 'ok' }; };
  const res = await registerClaudeMcp({ rootDir: '/x/docs', serverName: 'rag-docs', run });
  assert.equal(res.registered, true);
  assert.deepEqual(calls, [['claude', 'mcp', 'add', 'rag-docs', '--', 'karajan-rag', 'serve', '/x/docs']]);
  assert.equal(res.command, 'claude mcp add rag-docs -- karajan-rag serve /x/docs');
  const spaced = await registerClaudeMcp({ rootDir: "/x/My Docs/it's", serverName: 'rag-docs', run });
  assert.equal(spaced.command, String.raw`claude mcp add rag-docs -- karajan-rag serve '/x/My Docs/it'\''s'`);
});

test('registerClaudeMcp: without claude on the PATH it says so and hands over the command', async () => {
  const run = async () => { throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }); };
  const res = await registerClaudeMcp({ rootDir: '/x/docs', serverName: 'rag-docs', run });
  assert.equal(res.registered, false);
  assert.match(res.reason, /claude.*PATH/);
  assert.equal(res.command, 'claude mcp add rag-docs -- karajan-rag serve /x/docs');
  await assert.rejects(registerClaudeMcp({ rootDir: '/x', serverName: 'r', run: async () => { throw new Error('boom'); } }), /boom/);
});

test('setupClaude: registers, writes the block and says what it did', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-agent-'));
  /** @type {string[]} */
  const logs = [];
  try {
    const res = await setupClaude({ rootDir: root, log: (m) => logs.push(m), run: async () => ({ stdout: '' }) });
    assert.equal(res.registered, true);
    assert.equal(res.claudeMd.action, 'created');
    assert.ok(logs.some((l) => l.includes('claude mcp add')) && logs.some((l) => l.includes('CLAUDE.md')));
    const off = await setupClaude({ rootDir: root, log: (m) => logs.push(m), run: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });
    assert.equal(off.registered, false);
    assert.ok(logs.at(-2)?.includes('PATH'), 'tells that claude is missing and leaves the command');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
