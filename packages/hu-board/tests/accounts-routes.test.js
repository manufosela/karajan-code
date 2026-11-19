// HU-4594 slice 1: /api/accounts reads accounts.json only and writes through the kj CLI.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('karajan-core/process', () => ({ runCommand: vi.fn() }));

const { runCommand } = await import('karajan-core/process');
const { default: accountsRoutes } = await import('../src/routes/accounts.js');

const app = express().use(express.json()).use('/api/accounts', accountsRoutes);
const MARKER = 'sk-ant-RESCUE-MARKER';
let home;
let project;

beforeEach(() => {
  vi.clearAllMocks();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-accounts-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-proj-'));
  fs.mkdirSync(path.join(project, '.karajan'));
  process.env.KJ_HOME = home;
  runCommand.mockResolvedValue({ exitCode: 0, stdout: 'done', stderr: '' });
});

afterEach(() => {
  delete process.env.KJ_HOME;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

describe('GET /api/accounts', () => {
  it('is empty when there is no accounts.json', async () => {
    const res = await request(app).get('/api/accounts');
    expect(res.body).toEqual({ ok: true, accounts: [], default: {}, projects: {} });
  });

  it('lists accounts, names projects by basename and never reads rescue.json', async () => {
    fs.writeFileSync(path.join(home, 'rescue.json'), JSON.stringify({ key: MARKER }));
    fs.writeFileSync(path.join(home, 'accounts.json'), JSON.stringify({
      accounts: [{ id: 'work', provider: 'claude', dir: '/a/work', pace: { gapSeconds: 5 }, token: MARKER }],
      default: { claude: 'work' },
      projects: { '/Users/me/secret-path/app': { claude: ['work'] } },
    }));
    const res = await request(app).get('/api/accounts');
    expect(res.body.accounts).toEqual([{ id: 'work', provider: 'claude', dir: '/a/work', pace: { gapSeconds: 5 } }]);
    expect(res.body.default).toEqual({ claude: 'work' });
    expect(res.body.projects).toEqual({ app: { claude: ['work'] } });
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
    expect(JSON.stringify(res.body)).not.toContain('secret-path');
  });
});

describe('POST writes build kj argv', () => {
  const cases = [
    ['add', { id: 'work', provider: 'codex', dir: '/a/work' }, ['account', 'add', 'work', '--provider', 'codex', '--dir', '/a/work']],
    ['default', { id: 'work' }, ['account', 'default', 'work']],
    ['remove', { id: 'work' }, ['account', 'remove', 'work']],
    ['pace', { id: 'work', gap: 5, limitWait: 0 }, ['account', 'pace', 'work', '--gap', '5', '--limit-wait', '0']],
    ['pace', { id: 'work', gap: 1, max: 2, limitWait: 3 }, ['account', 'pace', 'work', '--gap', '1', '--max', '2', '--limit-wait', '3']],
  ];
  it.each(cases)('/%s', async (route, body, argv) => {
    const res = await request(app).post(`/api/accounts/${route}`).send(body);
    expect(res.status).toBe(200);
    expect(runCommand).toHaveBeenCalledWith('kj', argv, expect.any(Object));
  });

  it('/use runs in the project directory, with --clear when asked', async () => {
    await request(app).post('/api/accounts/use').send({ ids: ['a', 'b'], dir: project });
    expect(runCommand).toHaveBeenCalledWith('kj', ['account', 'use', 'a', 'b'], { cwd: project });
    await request(app).post('/api/accounts/use').send({ ids: ['a'], clear: true, dir: project });
    expect(runCommand).toHaveBeenLastCalledWith('kj', ['account', 'use', 'a', '--clear'], { cwd: project });
  });

  it('/use is 404 outside a karajan project', async () => {
    const res = await request(app).post('/api/accounts/use').send({ ids: ['a'], dir: os.tmpdir() });
    expect(res.status).toBe(404);
    expect(runCommand).not.toHaveBeenCalled();
  });
});

describe('validation and failures', () => {
  const bad = [
    ['add', { id: 'Bad Id', provider: 'claude', dir: '/a' }],
    ['add', { id: 'ok', provider: 'gemini', dir: '/a' }],
    ['add', { id: 'ok', provider: 'claude', dir: 'relative/dir' }],
    ['default', { id: '--flag' }],
    ['remove', { id: 'a;b' }],
    ['use', { ids: ['ok', '--clear'] }],
    ['use', { ids: 'ok' }],
    ['pace', { id: 'ok', gap: -1 }],
    ['pace', { id: 'ok', max: 'x' }],
    ['pace', { id: 'ok', limitWait: Infinity }],
  ];
  it.each(bad)('/%s %j is 400 and runs nothing', async (route, body) => {
    const res = await request(app).post(`/api/accounts/${route}`).send(body);
    expect(res.status).toBe(400);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('a kj failure is 409 with its message', async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'accounts: no account "ghost"' });
    const res = await request(app).post('/api/accounts/remove').send({ id: 'ghost' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('accounts: no account "ghost"');
  });
});
