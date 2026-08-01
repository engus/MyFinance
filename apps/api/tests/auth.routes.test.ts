import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
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

  it('returns 500 instead of crashing when an unexpected error occurs in an async handler', async () => {
    // Use a freshly-created app so this test's request doesn't get counted
    // against the shared `app` instance's rate limiter (which is also
    // exercised by every other test in this file).
    const isolatedApp = createApp(testPrisma);

    // NOTE: vi.spyOn(...).mockRestore() does not work reliably against
    // Prisma Client's model delegates (e.g. testPrisma.user) — Prisma
    // memoizes each model's methods as own properties on first access, and
    // vi's mockRestore leaves the property `undefined` afterward instead of
    // restoring the original function (verified independently while
    // authoring this test). So the original is saved and reassigned by
    // hand instead of relying on vi.spyOn/mockRestore.
    const originalFindUnique = testPrisma.user.findUnique.bind(testPrisma.user);
    testPrisma.user.findUnique = vi.fn().mockRejectedValueOnce(new Error('simulated DB failure'));

    try {
      const res = await request(isolatedApp)
        .post('/api/auth/login')
        .send({ email: 'a@b.com', password: 'password123' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    } finally {
      testPrisma.user.findUnique = originalFindUnique;
    }
  });

  it('returns 500 instead of crashing when requireAuth hits an unexpected error', async () => {
    // Isolated app + agent, same reasoning as the previous test: avoid
    // sharing the rate limiter counter with other tests in this file.
    const isolatedApp = createApp(testPrisma);
    const agent = request.agent(isolatedApp);

    await agent.post('/api/auth/register').send({ email: 'a@b.com', password: 'password123' });

    // getSession() -> prisma.session.findUnique is on the requireAuth path
    // exercised by GET /api/auth/me; make it reject once to simulate a
    // transient DB failure inside the auth middleware itself. Manual
    // save/restore (not vi.spyOn/mockRestore) for the same reason as above.
    const originalFindUnique = testPrisma.session.findUnique.bind(testPrisma.session);
    testPrisma.session.findUnique = vi.fn().mockRejectedValueOnce(new Error('simulated DB failure'));

    try {
      const res = await agent.get('/api/auth/me');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    } finally {
      testPrisma.session.findUnique = originalFindUnique;
    }
  });
});
