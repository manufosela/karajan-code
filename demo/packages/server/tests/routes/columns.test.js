import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestDb, createTestApp, seedUser, seedBoard, seedColumn } from '../helpers.js';

describe('Column routes', () => {
  let db, app, user, cookie, board;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    const seeded = await seedUser(db);
    user = seeded.user;
    cookie = seeded.cookie;
    board = seedBoard(db, user.id);
  });

  afterEach(() => db.close());

  it('GET /api/boards/:id/columns returns columns', async () => {
    seedColumn(db, board.id, 'Todo', 0);
    seedColumn(db, board.id, 'Done', 1);
    const res = await request(app)
      .get(`/api/boards/${board.id}/columns`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.columns).toHaveLength(2);
    expect(res.body.columns[0].title).toBe('Todo');
  });

  it('POST /api/boards/:id/columns creates a column', async () => {
    const res = await request(app)
      .post(`/api/boards/${board.id}/columns`)
      .set('Cookie', cookie)
      .send({ title: 'In Progress' });
    expect(res.status).toBe(201);
    expect(res.body.column.title).toBe('In Progress');
  });

  it('PUT /api/columns/:id updates a column', async () => {
    const col = seedColumn(db, board.id);
    const res = await request(app)
      .put(`/api/columns/${col.id}`)
      .set('Cookie', cookie)
      .send({ title: 'Renamed' });
    expect(res.status).toBe(200);
  });

  it('DELETE /api/columns/:id deletes a column', async () => {
    const col = seedColumn(db, board.id);
    const res = await request(app)
      .delete(`/api/columns/${col.id}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent board', async () => {
    const res = await request(app)
      .get('/api/boards/nonexistent/columns')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});
