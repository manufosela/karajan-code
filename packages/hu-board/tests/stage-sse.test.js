// KJC-TSK-1403 (ADR 0046): /api/events?project=<slug> adds that project's stage feed.
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import express from 'express';

let tmp, proj, slug, server, port, prev;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'hu-board-stage-sse-'));
  proj = join(tmp, 'work', 'proj');
  mkdirSync(join(proj, '.karajan', 'harness'), { recursive: true });
  prev = { home: process.env.KJ_HOME, plans: process.env.KJ_PLANS_DIR };
  process.env.KJ_HOME = join(tmp, 'home');
  process.env.KJ_PLANS_DIR = join(tmp, 'plans');
  const { deriveProjectIdFromDir } = await import('../src/sync.js');
  slug = deriveProjectIdFromDir(proj);
  mkdirSync(join(tmp, 'plans', slug), { recursive: true });
  writeFileSync(join(tmp, 'plans', slug, 'plan-1.json'), JSON.stringify({ projectDir: proj }));
  const { default: apiRoutes } = await import('../src/routes/api.js');
  const app = express();
  app.use('/api', apiRoutes);
  await new Promise((resolve) => { server = app.listen(0, () => { port = server.address().port; resolve(); }); });
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  for (const [k, v] of [['KJ_HOME', prev.home], ['KJ_PLANS_DIR', prev.plans]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(tmp, { recursive: true, force: true });
});

/** Opens the stream and keeps writing denials until one arrives as an event. */
function firstDataFrame(path, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    let writer;
    const req = http.get({ host: 'localhost', port, path }, (res) => {
      if (res.statusCode !== 200) { resolve({ status: res.statusCode }); req.destroy(); return; }
      let buf = '';
      writer = setInterval(() => appendFileSync(join(proj, '.karajan', 'harness', 'denials.jsonl'), '{"at":"t","tool":"Bash","why":"no"}\n'), 300);
      res.on('data', (chunk) => {
        buf += chunk.toString('utf-8');
        const frame = buf.split('\n\n').find((f) => f.startsWith('data:'));
        if (frame) { clearInterval(writer); req.destroy(); resolve({ status: 200, event: JSON.parse(frame.slice(5)) }); }
      });
    });
    req.on('error', () => {});
    setTimeout(() => { clearInterval(writer); req.destroy(); reject(new Error('no stage event arrived')); }, timeoutMs);
  });
}

describe('GET /api/events?project=<slug>', () => {
  it('streams the stage events of the project it names', async () => {
    const { event } = await firstDataFrame(`/api/events?project=${slug}`);
    expect(event).toEqual({ type: 'sentinel-deny', at: 't', tool: 'Bash', why: 'no', project: slug, lane: 'main' });
  });

  it('answers 400 to a project it cannot resolve, without opening the stream', async () => {
    const { status } = await firstDataFrame('/api/events?project=nowhere');
    expect(status).toBe(400);
  });
});

// KJC-TSK-1446 (ADR 0049): the map lists every factory and streams them all through one connection.
describe('the map of every factory', () => {
  it('lists the factory of a known project and streams its events tagged with project and lane', async () => {
    const { closeDb, initDb, upsertProject } = await import('../src/db.js');
    initDb();
    onTestFinished(() => closeDb());
    upsertProject({ id: slug });
    const map = await (await fetch(`http://localhost:${port}/api/stage/map`)).json();
    expect(map.map((f) => [f.project, f.lanes.map((l) => l.lane)])).toEqual([[slug, ['main']]]);
    const { event } = await firstDataFrame('/api/events?map=1');
    expect(event).toEqual({ type: 'sentinel-deny', at: 't', tool: 'Bash', why: 'no', project: slug, lane: 'main' });
  });
});
