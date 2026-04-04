import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestDb, createTestApp } from '../helpers.js';

describe('Auth flow integration', () => {
  let db, app;

  beforeEach(() => {
    db = createTestDb();
    app = createTestApp(db);
  });

  afterEach(() => db.close());

  it('register → login → refresh → logout', async () => {
    // Register
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'flow@test.com', password: 'Password123' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.email).toBe('flow@test.com');

    const cookies = reg.headers['set-cookie'];
    expect(cookies).toBeDefined();

    // Login
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'flow@test.com', password: 'Password123' });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('flow@test.com');

    const loginCookies = login.headers['set-cookie'];
    const refreshCookie = loginCookies.find((c) => c.startsWith('refresh_token='));

    // Refresh
    const refresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie);
    expect(refresh.status).toBe(200);
    expect(refresh.body.user.email).toBe('flow@test.com');

    // Logout
    const logout = await request(app)
      .post('/api/auth/logout');
    expect(logout.status).toBe(200);
  });

  it('rejects duplicate registration', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@test.com', password: 'Password123' });

    const dup = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@test.com', password: 'Password123' });
    expect(dup.status).toBe(409);
  });

  it('rejects wrong password', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'wrong@test.com', password: 'Password123' });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrong@test.com', password: 'WrongPass' });
    expect(login.status).toBe(401);
  });

  it('rejects login for non-existent user', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.com', password: 'Password123' });
    expect(login.status).toBe(401);
  });

  it('validates registration input', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('rejects refresh without token', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('health check works without auth', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime).toBeDefined();
  });
});
