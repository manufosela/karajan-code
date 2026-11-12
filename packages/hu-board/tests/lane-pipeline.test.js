// HU-4029: a lane with an open pull request says whether its pipeline is running, failed, or
// passed and waiting for merge, from the checks `gh pr view` reports.
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cachedPipeline, lanePipelines, pipelineFacts, pipelineOf } from '../src/lane-pipeline.js';
import { laneStatus, laneStatuses, statusLine } from '../public/stage/lane-status.js';

const run = (status, conclusion = '') => ({ __typename: 'CheckRun', status, conclusion });
const synced = { head: 'feat/x', upstream: 'origin/feat/x', gone: false, ahead: 0 };

describe('pipelineOf', () => {
  it('is failed when any check failed, even while others still run', () => {
    expect(pipelineOf([run('COMPLETED', 'SUCCESS'), run('IN_PROGRESS'), run('COMPLETED', 'FAILURE')])).toBe('failed');
    expect(pipelineOf([{ __typename: 'StatusContext', state: 'ERROR' }])).toBe('failed');
  });

  it('is running while a check has not finished, passed when all finished well', () => {
    expect(pipelineOf([run('COMPLETED', 'SUCCESS'), run('QUEUED')])).toBe('running');
    expect(pipelineOf([{ __typename: 'StatusContext', state: 'PENDING' }])).toBe('running');
    expect(pipelineOf([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED'), { __typename: 'StatusContext', state: 'SUCCESS' }])).toBe('passed');
  });

  it('reads no pipeline from no checks', () => {
    expect(pipelineOf([])).toBeNull();
    expect(pipelineOf(undefined)).toBeNull();
  });
});

describe('pipelineFacts', () => {
  const view = (json) => async () => JSON.stringify(json);
  it('reads the pipeline of an open pull request only', async () => {
    await expect(pipelineFacts('/lane', { run: view({ state: 'OPEN', statusCheckRollup: [run('COMPLETED', 'SUCCESS')] }) })).resolves.toBe('passed');
    await expect(pipelineFacts('/lane', { run: view({ state: 'MERGED', statusCheckRollup: [run('COMPLETED', 'SUCCESS')] }) })).resolves.toBeNull();
  });

  it('is null when gh fails or answers garbage, never a guess', async () => {
    await expect(pipelineFacts('/lane', { run: async () => { throw new Error('no pr'); } })).resolves.toBeNull();
    await expect(pipelineFacts('/lane', { run: async () => 'not json' })).resolves.toBeNull();
  });
});

describe('reading gh, a network call', () => {
  it('reads a lane once in 30 seconds, sharing the read in flight', async () => {
    let reads = 0;
    const read = async () => { reads += 1; return 'running'; };
    const at = (now) => cachedPipeline('/cached', { now, read });
    expect(await Promise.all([at(0), at(29_999)])).toEqual(['running', 'running']);
    await at(30_000);
    expect(reads).toBe(2);
  });

  it('reads every lane but the main checkout, never more than `limit` at once', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'lane-pipeline-'));
    const dirs = ['a', 'b', 'c'].map((name) => join(proj, '.kj', 'worktrees', name));
    for (const dir of dirs) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, '.git'), 'gitdir: x\n'); }
    let open = 0;
    let peak = 0;
    const read = async (dir) => { open += 1; peak = Math.max(peak, open); await new Promise((r) => setTimeout(r, 10)); open -= 1; return dir; };
    const pipelines = await lanePipelines(proj, { limit: 2, read });
    rmSync(proj, { recursive: true, force: true });
    expect(peak).toBe(2);
    expect([...pipelines].toSorted()).toEqual(dirs.map((dir) => [dir, dir]));
  });
});

describe('a lane with an open pull request', () => {
  const lane = (pipeline) => laneStatus({ lane: 'x', branch: synced, pipeline });
  it('says its pipeline runs, failed, or passed and waits for merge', () => {
    expect(lane('running')).toEqual({ state: 'waiting-merge', why: 'pipeline running' });
    expect(lane('failed')).toEqual({ state: 'failed', why: 'pipeline failed' });
    expect(lane('passed')).toEqual({ state: 'waiting-merge', why: 'pipeline passed, waits for merge' });
  });

  it('shows it even when the branch has unpushed commits, but never over work or handoffs', () => {
    expect(laneStatus({ lane: 'x', branch: { ...synced, ahead: 2 }, pipeline: 'failed' }).state).toBe('failed');
    expect(laneStatus({ lane: 'x', branch: synced, pipeline: 'failed', mail: 1 }).state).toBe('waiting-person');
    expect(laneStatus({ lane: 'x', branch: synced, pipeline: 'failed', working: [{ role: 'coder' }] }).state).toBe('working');
  });

  it('reaches the live status and its line', () => {
    const status = laneStatuses(['x'], { lanes: [{ lane: 'x', branch: synced, pipeline: 'failed' }] }, new Map()).get('x');
    expect(statusLine(status)).toBe('failed: pipeline failed');
  });
});
