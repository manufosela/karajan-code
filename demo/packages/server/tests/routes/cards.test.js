import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestDb, createTestApp, seedUser, seedBoard, seedColumn, seedCard } from '../helpers.js';

describe('Card routes', () => {
  let db, app, cookie, column;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    const seeded = await seedUser(db);
    cookie = seeded.cookie;
    const board = seedBoard(db, seeded.user.id);
    column = seedColumn(db, board.id);
  });

  afterEach(() => db.close());

  it('GET /api/columns/:id/cards returns cards', async () => {
    seedCard(db, column.id, 'Card 1', 0);
    seedCard(db, column.id, 'Card 2', 1);
    const res = await request(app)
      .get(`/api/columns/${column.id}/cards`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(2);
  });

  it('POST /api/columns/:id/cards creates a card', async () => {
    const res = await request(app)
      .post(`/api/columns/${column.id}/cards`)
      .set('Cookie', cookie)
      .send({ title: 'New Card', description: 'Details' });
    expect(res.status).toBe(201);
    expect(res.body.card.title).toBe('New Card');
    expect(res.body.card.description).toBe('Details');
  });

  it('PUT /api/cards/:id updates a card', async () => {
    const card = seedCard(db, column.id);
    const res = await request(app)
      .put(`/api/cards/${card.id}`)
      .set('Cookie', cookie)
      .send({ title: 'Updated Title' });
    expect(res.status).toBe(200);
  });

  it('PATCH /api/cards/:id/move moves a card', async () => {
    const board = db.prepare('SELECT board_id FROM columns WHERE id = ?').get(column.id);
    const col2 = seedColumn(db, board.board_id, 'Done', 1);
    const card = seedCard(db, column.id, 'Movable', 0);

    const res = await request(app)
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', cookie)
      .send({ columnId: col2.id, position: 0 });
    expect(res.status).toBe(200);
    expect(res.body.card.column_id).toBe(col2.id);
  });

  it('DELETE /api/cards/:id deletes a card', async () => {
    const card = seedCard(db, column.id);
    const res = await request(app)
      .delete(`/api/cards/${card.id}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent column', async () => {
    const res = await request(app)
      .get('/api/columns/nonexistent/cards')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('validates card creation input', async () => {
    const res = await request(app)
      .post(`/api/columns/${column.id}/cards`)
      .set('Cookie', cookie)
      .send({ title: '' });
    expect(res.status).toBe(400);
  });
});
