// KJC-TSK-1313: GET /api/lanes/:project — each card's worktree lanes, from `kj worktree list --json`
// (the board never imports the CLI tree), keyed by the board's story id.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('karajan-core/process', () => ({ runCommand: vi.fn() }));
vi.mock('../src/project-dir.js', () => ({ requestProjectDir: vi.fn() }));

const { runCommand } = await import('karajan-core/process');
const { requestProjectDir } = await import('../src/project-dir.js');
const { default: lanesRoutes } = await import('../src/routes/lanes.js');

const app = express().use('/api/lanes', lanesRoutes);
const lane = (slug, cards, ahead = 1) => ({ slug, branch: `feat/${slug}`, path: `/repo/.kj/worktrees/${slug}`, ahead, cards });

beforeEach(() => {
  vi.clearAllMocks();
  requestProjectDir.mockReturnValue('/repo');
});

describe('GET /api/lanes/:project', () => {
  it('keys each lane by the story id of every card its branch names', async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: `[info] noise\n${JSON.stringify([lane('HU-27-fix', ['HU-27']), lane('both', ['HU-27', 'HU-30'], 0)])}\n`, stderr: '' });
    const res = await request(app).get('/api/lanes/proj-1');
    expect(res.status).toBe(200);
    expect(runCommand).toHaveBeenCalledWith('kj', ['worktree', 'list', '--json'], { cwd: '/repo' });
    expect(Object.keys(res.body.byStory).toSorted()).toEqual(['proj-1::HU-27', 'proj-1::HU-30']);
    expect(res.body.byStory['proj-1::HU-27'].map((l) => l.slug)).toEqual(['HU-27-fix', 'both']);
  });

  it('a project that cannot be resolved or a kj that fails gives no lanes and says why, never a 500', async () => {
    requestProjectDir.mockImplementation(() => { throw new Error('project "x" has no plan'); });
    const unresolved = await request(app).get('/api/lanes/x');
    expect(unresolved.body).toEqual({ byStory: {}, error: 'project "x" has no plan' });

    requestProjectDir.mockReturnValue('/repo');
    runCommand.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'boom' });
    const failed = await request(app).get('/api/lanes/proj-1');
    expect(failed.status).toBe(200);
    expect(failed.body.byStory).toEqual({});
    expect(failed.body.error).toMatch(/exit 1/);
  });
});
