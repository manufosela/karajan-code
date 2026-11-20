// HU-4716 slice 1: /api/accounts/rescue shows the rescue rules and sets them through the kj CLI, never the key.
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

beforeEach(() => {
  vi.clearAllMocks();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-rescue-'));
  process.env.KJ_HOME = home;
  runCommand.mockResolvedValue({ exitCode: 0, stdout: 'done', stderr: '' });
});

afterEach(() => {
  delete process.env.KJ_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('GET /api/accounts/rescue', () => {
  it('is keyless with no rules when there is no rescue.json', async () => {
    const res = await request(app).get('/api/accounts/rescue');
    expect(res.body).toEqual({ ok: true, rescue: { claude: { hasKey: false, rules: {} }, codex: { hasKey: false, rules: {} } } });
  });

  it('shows the rules and whether a key exists, never the key', async () => {
    fs.writeFileSync(path.join(home, 'rescue.json'), JSON.stringify({
      claude: { key: MARKER, keyEnv: MARKER, rules: { window: '9-18', daily: 3 } },
    }));
    const res = await request(app).get('/api/accounts/rescue');
    expect(res.body.rescue.claude).toEqual({ hasKey: true, rules: { window: '9-18', daily: 3 } });
    expect(res.body.rescue.codex).toEqual({ hasKey: false, rules: {} });
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
  });

  it('a failing write never echoes the key either', async () => {
    fs.writeFileSync(path.join(home, 'rescue.json'), JSON.stringify({ claude: { key: MARKER, rules: {} } }));
    const res = await request(app).post('/api/accounts/rescue').send({ provider: 'claude', key: MARKER });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
  });
});

describe('POST /api/accounts/rescue builds kj argv', () => {
  const cases = [
    [{ provider: 'claude' }, ['account', 'rescue', 'claude']],
    [{ provider: 'codex', limit: true, window: '9-18' }, ['account', 'rescue', 'codex', '--limit', '--window', '9-18']],
    [{ provider: 'claude', limit: false }, ['account', 'rescue', 'claude']],
    [{ provider: 'claude', roles: ['coder', 'reviewer'], models: ['opus', 'gpt-5.1:high'] },
      ['account', 'rescue', 'claude', '--roles', 'coder,reviewer', '--models', 'opus,gpt-5.1:high']],
    [{ provider: 'claude', daily: 0, monthly: 12.5 }, ['account', 'rescue', 'claude', '--daily', '0', '--monthly', '12.5']],
  ];
  it.each(cases)('%j', async (body, argv) => {
    const res = await request(app).post('/api/accounts/rescue').send(body);
    expect(res.status).toBe(200);
    expect(runCommand).toHaveBeenCalledWith('kj', argv, expect.any(Object));
  });

  it('/rescue/remove passes --remove', async () => {
    await request(app).post('/api/accounts/rescue/remove').send({ provider: 'codex' });
    expect(runCommand).toHaveBeenCalledWith('kj', ['account', 'rescue', 'codex', '--remove'], expect.any(Object));
  });
});

describe('validation and failures', () => {
  const bad = [
    { provider: 'claude', key: 'x' },
    { provider: 'claude', keyEnv: 'KEY' },
    { provider: 'claude', keyStdin: true },
    { provider: 'claude', keyStdin: false },
    { provider: 'gemini' },
    {},
    { provider: 'claude', window: '9-18; rm' },
    { provider: 'claude', window: '123-4' },
    { provider: 'claude', roles: 'coder' },
    { provider: 'claude', roles: ['--remove'] },
    { provider: 'claude', models: ['a b'] },
    { provider: 'claude', models: [1] },
    { provider: 'claude', daily: -1 },
    { provider: 'claude', monthly: 'x' },
    { provider: 'claude', daily: Infinity },
    { provider: 'claude', limit: 'yes' },
  ];
  it.each(bad)('%j is 400 and runs nothing', async (body) => {
    const res = await request(app).post('/api/accounts/rescue').send(body);
    expect(res.status).toBe(400);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('/rescue/remove with a bad provider is 400 and runs nothing', async () => {
    const res = await request(app).post('/api/accounts/rescue/remove').send({ provider: 'gemini' });
    expect(res.status).toBe(400);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('a kj failure is 409 with its message', async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'rescue: no key for claude' });
    const res = await request(app).post('/api/accounts/rescue').send({ provider: 'claude', daily: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('rescue: no key for claude');
  });
});
