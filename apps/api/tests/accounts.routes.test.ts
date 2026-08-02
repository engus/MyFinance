import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { testPrisma, truncateAll } from './helpers/db';
import { createApp } from '../src/app';

const app = createApp(testPrisma);

async function registerAgent(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ email, password: 'password123' });
  return { agent, csrfToken: res.body.csrfToken as string };
}

describe('accounts routes', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('creates, lists, updates, and deletes an account', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');

    const empty = await agent.get('/api/accounts');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    const created = await agent
      .post('/api/accounts')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Card');

    const listed = await agent.get('/api/accounts');
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].balance).toBe('0');

    const updated = await agent
      .patch(`/api/accounts/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Renamed' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Renamed');

    const deleted = await agent
      .delete(`/api/accounts/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken);
    expect(deleted.status).toBe(200);
    expect(deleted.body.hardDeleted).toBe(true);

    const afterDelete = await agent.get('/api/accounts');
    expect(afterDelete.body).toEqual([]);
  });

  it('rejects account creation with an invalid payload', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');

    const res = await agent
      .post('/api/accounts')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: '', kind: 'FINANCIAL', currency: 'USD' });

    expect(res.status).toBe(400);
  });

  it("returns 404 when patching another user's account", async () => {
    const owner = await registerAgent('owner@b.com');
    const stranger = await registerAgent('stranger@b.com');

    const created = await owner.agent
      .post('/api/accounts')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });

    const res = await stranger.agent
      .patch(`/api/accounts/${created.body.id}`)
      .set('X-CSRF-Token', stranger.csrfToken)
      .send({ name: 'Stolen' });

    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/accounts');
    expect(res.status).toBe(401);
  });
});
