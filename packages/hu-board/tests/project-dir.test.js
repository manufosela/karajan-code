// KJC-TSK-0885 (BRD-P2, ADR 0011): la vista /p/<slug> lee y escribe la config
// de SU proyecto, nunca la del cwd del daemon (que era packages/hu-board). El
// slug viaja en la peticion; la ruta la resuelve el servidor desde los planes,
// que ya guardan projectDir, y solo si el slug de ese dir es el pedido.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

import { projectDirForSlug } from '../src/project-dir.js';
import { deriveProjectIdFromDir } from '../src/sync.js';

let tmp, plans, proj, slug, prev;
const plan = (s, projectDir) => {
  mkdirSync(join(plans, s), { recursive: true });
  writeFileSync(join(plans, s, 'plan-1.json'), JSON.stringify({ projectDir }));
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hu-board-pdir-'));
  plans = join(tmp, 'plans');
  proj = join(tmp, 'work', 'proj');
  mkdirSync(join(proj, '.karajan'), { recursive: true });
  slug = deriveProjectIdFromDir(proj);
  plan(slug, proj);
  prev = { home: process.env.KJ_HOME, plans: process.env.KJ_PLANS_DIR };
  process.env.KJ_HOME = join(tmp, 'home');
  process.env.KJ_PLANS_DIR = plans;
});
afterEach(() => {
  for (const [k, v] of [['KJ_HOME', prev.home], ['KJ_PLANS_DIR', prev.plans]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe('projectDirForSlug', () => {
  it('resolves the project dir its plans recorded', () => {
    expect(projectDirForSlug(slug, { plansDirs: [plans] })).toBe(proj);
  });

  it('refuses a plan whose dir belongs to another slug (a plan cannot point anywhere)', () => {
    plan('home_other', proj);
    expect(projectDirForSlug('home_other', { plansDirs: [plans] })).toBeNull();
  });

  it('refuses slugs with path characters and unknown slugs', () => {
    expect(projectDirForSlug('../etc', { plansDirs: [plans] })).toBeNull();
    expect(projectDirForSlug('nope', { plansDirs: [plans] })).toBeNull();
  });
});

describe('GET/PUT /api/config?scope=project with a project', () => {
  let app;
  beforeEach(async () => {
    const { default: apiRoutes } = await import('../src/routes/api.js');
    app = express();
    app.use(express.json());
    app.use('/api', apiRoutes);
  });

  it("reads and writes that project's kj.config.yml", async () => {
    writeFileSync(join(proj, '.karajan', 'kj.config.yml'), 'max_iterations: 7\n');
    const got = await request(app).get(`/api/config?scope=project&project=${slug}`);
    expect(got.status).toBe(200);
    expect(got.body.path).toBe(join(proj, '.karajan', 'kj.config.yml'));
    const put = await request(app).put('/api/config').send({ scope: 'project', project: slug, patch: {} });
    expect(put.body.path ?? put.body.details?.path).toBe(join(proj, '.karajan', 'kj.config.yml'));
    expect(readFileSync(join(proj, '.karajan', 'kj.config.yml'), 'utf8')).toContain('max_iterations: 7');
  });

  it('an unresolvable project is a 400 that says why, never the daemon cwd', async () => {
    const got = await request(app).get('/api/config?scope=project&project=nope');
    expect(got.status).toBe(400);
    expect(got.body.error).toMatch(/nope/);
  });
});

// KJC-TSK-0885 paso 3: el buscador RAG de la vista abre el indice de SU
// proyecto; antes abria la base global sin filtro y traia chunks de cualquiera.
describe('POST /api/rag/query with a project', () => {
  it("searches that project's index, never the machine-wide one", async () => {
    const { openVecStore, insertChunk } = await import('karajan-core/vec-store');
    process.env.KJ_RAG_DB = join(tmp, 'global.db');
    const g = openVecStore({ dim: 768, path: process.env.KJ_RAG_DB });
    insertChunk(g, { source: '/other/x.js', kind: 'code', text: 'ajeno', embedding: new Float32Array(768).fill(0.1), project: 'other' });
    g.close();
    try {
      const { default: apiRoutes } = await import('../src/routes/api.js');
      const app = express();
      app.use(express.json());
      app.use('/api', apiRoutes);
      const res = await request(app).post('/api/rag/query').send({ text: 'x', project: slug });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ empty: true, hits: [] });
      const bad = await request(app).post('/api/rag/query').send({ text: 'x', project: 'nope' });
      expect(bad.status).toBe(400);
    } finally {
      delete process.env.KJ_RAG_DB;
    }
  });
});
