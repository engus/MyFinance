import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { testPrisma, truncateAll } from './helpers/db';
import { createApp } from '../src/app';

const app = createApp(testPrisma);

describe('auth routes', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('registers, reads /me, and logs out', async () => {
    const agent = request.agent(app);

    const registerRes = await agent
      .post('/api/auth/register')
      .send({ email: 'a@b.com', password: 'password123' });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.email).toBe('a@b.com');
    const csrfToken = registerRes.body.csrfToken as string;

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe('a@b.com');

    const logoutRes = await agent.post('/api/auth/logout').set('X-CSRF-Token', csrfToken);
    expect(logoutRes.status).toBe(204);

    const meAfterLogout = await agent.get('/api/auth/me');
    expect(meAfterLogout.status).toBe(401);
  });

  it('rejects logout without a valid CSRF token', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email: 'a@b.com', password: 'password123' });

    const res = await agent.post('/api/auth/logout').set('X-CSRF-Token', 'wrong-token');
    expect(res.status).toBe(403);
  });

  it('rejects login with a wrong password', async () => {
    await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('rejects registration with an invalid payload', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
  });
});
