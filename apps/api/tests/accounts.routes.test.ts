import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { testPrisma, truncateAll } from './helpers/db';
import { createApp } from '../src/app';

const app = createApp(testPrisma);

async function registerAgent(email: string, onApp = app) {
  const agent = request.agent(onApp);
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

  it('reconciles an account with no recurring templates due', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const created = await agent
      .post('/api/accounts')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });

    const res = await agent
      .post(`/api/accounts/${created.body.id}/reconcile`)
      .set('X-CSRF-Token', csrfToken)
      .send({ newBalance: '200.00', date: new Date().toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.delta).toBe('200');
    expect(res.body.applied).toBe(true);
    expect(res.body.generatedOccurrences).toEqual([]);
  });

  it('generates due recurring occurrences before computing the reconciliation delta', async () => {
    // Isolated app instance so this test's registration doesn't share the
    // shared `app`'s rate limiter counter with tests 1-5 in this file,
    // which already reach the authLimiter's max:5 on the shared instance
    // (same reasoning as tests/transactions.routes.test.ts).
    const isolatedApp = createApp(testPrisma);
    const { agent, csrfToken } = await registerAgent('a@b.com', isolatedApp);
    const account = await agent
      .post('/api/accounts')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });
    const categories = await agent.get('/api/categories');
    const rentId = categories.body.find((c: { name: string }) => c.name === 'Аренда/Жильё').id;

    // nextRunDate starts one day before "now" (rather than a fixed past date
    // like 2020-01-01) so exactly one MONTH period is due regardless of when
    // this suite runs — a fixed past date would let generateDueOccurrences
    // catch up every missed month between then and "now", producing more
    // than one occurrence and breaking the exact `-50` delta assertion
    // below. Same fix pattern as tests/recurring.service.test.ts
    // ("generates one occurrence when exactly one period is due").
    const almostNow = new Date();
    almostNow.setUTCDate(almostNow.getUTCDate() - 1);

    await testPrisma.transaction.create({
      data: {
        userId: (await testPrisma.user.findFirstOrThrow({ where: { email: 'a@b.com' } })).id,
        description: 'Rent',
        date: almostNow,
        frequency: 'RECURRING',
        interval: 'MONTH',
        nextRunDate: almostNow,
        templateAccountId: account.body.id,
        templateCategoryId: rentId,
        templateAmount: '-1000.00',
        templateCurrency: 'USD',
      },
    });

    const res = await agent
      .post(`/api/accounts/${account.body.id}/reconcile`)
      .set('X-CSRF-Token', csrfToken)
      .send({ newBalance: '-1050.00', date: new Date().toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.delta).toBe('-50');
    expect(res.body.generatedOccurrences.length).toBeGreaterThan(0);
  });

  it("returns 404 reconciling another user's account", async () => {
    // Isolated app instance so this test's two registrations don't share
    // the shared `app`'s rate limiter counter with tests 1-5 in this file
    // (same reasoning as tests/transactions.routes.test.ts).
    const isolatedApp = createApp(testPrisma);
    const owner = await registerAgent('owner@b.com', isolatedApp);
    const stranger = await registerAgent('stranger@b.com', isolatedApp);
    const created = await owner.agent
      .post('/api/accounts')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });

    const res = await stranger.agent
      .post(`/api/accounts/${created.body.id}/reconcile`)
      .set('X-CSRF-Token', stranger.csrfToken)
      .send({ newBalance: '1.00', date: new Date().toISOString() });

    expect(res.status).toBe(404);
  });
});
