// KJC-BUG-0497: the SPA fallback serves index.html to the app's routes, never to a missing file.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';

import { spaFallback } from '../src/spa-fallback.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const app = express().get('/{*splat}', spaFallback(PUBLIC_DIR));

describe('SPA fallback', () => {
  it('serves index.html, uncached, to a route of the app', async () => {
    const r = await request(app).get('/governance/rules').expect(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.headers['cache-control']).toBe('no-store, must-revalidate');
  });

  it('answers 404 to a file that does not exist, so a missing module is not taken for HTML', async () => {
    const js = await request(app).get('/stage/missing.js').expect(404);
    expect(js.headers['content-type']).not.toMatch(/text\/html/);
    await request(app).get('/styles/missing.css').expect(404);
  });

  it('a dot in a directory of the route is still a route, not a file', async () => {
    await request(app).get('/projects/v1.2/board').expect(200);
  });
});
