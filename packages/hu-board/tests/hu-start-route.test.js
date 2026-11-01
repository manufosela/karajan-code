// KJC-TSK-1324: POST /api/hu/:id/start, the ▶ of a card. The project is named, its directory
// resolved by the server (ADR 0011); the launcher itself is tested in command-runner.test.js.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/project-dir.js', () => ({ requestProjectDir: vi.fn() }));
vi.mock('../src/command-runner.js', () => ({ runKjCommand: vi.fn(), listSupportedCommands: vi.fn(() => []), startCardInLane: vi.fn() }));

const { requestProjectDir } = await import('../src/project-dir.js');
const { startCardInLane } = await import('../src/command-runner.js');
const { default: commands } = await import('../src/routes/api/commands.js');

const app = express().use(express.json()).use('/api', commands);
const start = (body) => request(app).post('/api/hu/HU-42/start').send(body);

beforeEach(() => vi.clearAllMocks());

describe('POST /api/hu/:id/start — KJC-TSK-1324', () => {
  it('resolves the project on the server and returns the run to tail', async () => {
    requestProjectDir.mockReturnValue('/repo');
    startCardInLane.mockReturnValue({ ok: true, commandId: 'cmd-hu-start-1', pid: 7, logPath: '/runs/cmd-hu-start-1.log' });
    const res = await start({ project: 'repo' });
    expect(res.status).toBe(200);
    expect(res.body.commandId).toBe('cmd-hu-start-1');
    expect(startCardInLane).toHaveBeenCalledWith({ id: 'HU-42', projectDir: '/repo' });
  });

  it('a card with a lane gets 409 and that lane', async () => {
    requestProjectDir.mockReturnValue('/repo');
    startCardInLane.mockReturnValue({ ok: false, lane: '/repo/.kj/worktrees/HU-42-x', error: 'HU-42 already has a lane' });
    const res = await start({ project: 'repo' });
    expect(res.status).toBe(409);
    expect(res.body.lane).toBe('/repo/.kj/worktrees/HU-42-x');
  });

  it('no project, an unknown project or a refused card id is a 400, and nothing is launched for the first two', async () => {
    requestProjectDir.mockReturnValue(null);
    expect((await start({})).status).toBe(400);
    requestProjectDir.mockImplementation(() => { throw new Error('project "x" has no plan'); });
    expect((await start({ project: 'x' })).status).toBe(400);
    expect(startCardInLane).not.toHaveBeenCalled();
    requestProjectDir.mockReset().mockReturnValue('/repo');
    startCardInLane.mockReturnValue({ ok: false, error: 'not a card id' });
    expect((await start({ project: 'repo' })).status).toBe(400);
  });
});
