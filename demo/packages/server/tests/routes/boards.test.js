import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestDb, createTestApp, seedUser, seedBoard } from '../helpers.js';

describe('Board routes', () => {
  let db, app, user, cookie;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    const seeded = await seedUser(db);
    user = seeded.user;
    cookie = seeded.cookie;
  });

  afterEach(() => db.close());

  it('GET /api/boards returns empty list', async () => {
    const res = await request(app).get('/api/boards').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.boards).toEqual([]);
  });

  it('POST /api/boards creates a board', async () => {
    const res = await request(app)
      .post('/api/boards')
      .set('Cookie', cookie)
      .send({ title: 'My Board' });
    expect(res.status).toBe(201);
    expect(res.body.board.title).toBe('My Board');
    expect(res.body.board.id).toBeDefined();
  });

  it('GET /api/boards/:id returns the board', async () => {
    const board = seedBoard(db, user.id, 'Board A');
    const res = await request(app).get(`/api/boards/${board.id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.board.title).toBe('Board A');
  });

  it('GET /api/boards/:id returns 404 for non-existent', async () => {
    const res = await request(app).get('/api/boards/nonexistent').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('PUT /api/boards/:id updates the board', async () => {
    const board = seedBoard(db, user.id);
    const res = await request(app)
      .put(`/api/boards/${board.id}`)
      .set('Cookie', cookie)
      .send({ title: 'Updated' });
    expect(res.status).toBe(200);
  });

  it('DELETE /api/boards/:id deletes the board', async () => {
    const board = seedBoard(db, user.id);
    const res = await request(app).delete(`/api/boards/${board.id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);

    const check = await request(app).get(`/api/boards/${board.id}`).set('Cookie', cookie);
    expect(check.status).toBe(404);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/boards');
    expect(res.status).toBe(401);
  });

  it('validates board creation input', async () => {
    const res = await request(app)
      .post('/api/boards')
      .set('Cookie', cookie)
      .send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});
