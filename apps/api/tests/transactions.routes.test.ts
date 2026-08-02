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

async function createAccount(agent: ReturnType<typeof request.agent>, csrfToken: string, name: string) {
  const res = await agent
    .post('/api/accounts')
    .set('X-CSRF-Token', csrfToken)
    .send({ name, kind: 'FINANCIAL', currency: 'USD' });
  return res.body.id as string;
}

async function categoryId(agent: ReturnType<typeof request.agent>, name: string) {
  const res = await agent.get('/api/categories');
  return (res.body.find((c: { name: string }) => c.name === name) as { id: string }).id;
}

describe('transactions routes', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('creates a one-off transaction and lists it', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const salaryId = await categoryId(agent, 'Зарплата');

    const created = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Salary',
        date: new Date().toISOString(),
        entries: [
          { accountId, amount: '1000.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-1000.00', currency: 'USD' },
        ],
      });
    expect(created.status).toBe(201);

    const listed = await agent.get('/api/transactions?frequency=ONE_OFF');
    expect(listed.body).toHaveLength(1);
  });

  it('creates a recurring template', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const rentId = await categoryId(agent, 'Аренда/Жильё');

    const created = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Rent',
        accountId,
        categoryId: rentId,
        amount: '-1000.00',
        currency: 'USD',
        interval: 'MONTH',
        startDate: new Date().toISOString(),
      });

    expect(created.status).toBe(201);
    expect(created.body.frequency).toBe('RECURRING');
  });

  it('rejects creating a CUSTOM recurring template without customDays', async () => {
    // Isolated app so this test's registration doesn't consume the shared
    // `app`'s rate limiter budget (see the "returns 404" test below for the
    // same reasoning).
    const isolatedApp = createApp(testPrisma);
    const { agent, csrfToken } = await registerAgent('custom-no-days@b.com', isolatedApp);
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const rentId = await categoryId(agent, 'Аренда/Жильё');

    const res = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Rent',
        accountId,
        categoryId: rentId,
        amount: '-1000.00',
        currency: 'USD',
        interval: 'CUSTOM',
        startDate: new Date().toISOString(),
      });

    expect(res.status).toBe(400);
  });

  it('rejects a malformed amount on a one-off transaction', async () => {
    // Isolated app for the same rate-limiter reason as above.
    const isolatedApp = createApp(testPrisma);
    const { agent, csrfToken } = await registerAgent('bad-amount-oneoff@b.com', isolatedApp);
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const salaryId = await categoryId(agent, 'Зарплата');

    const res = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Salary',
        date: new Date().toISOString(),
        entries: [
          { accountId, amount: 'not-a-number', currency: 'USD' },
          { categoryId: salaryId, amount: '-1000.00', currency: 'USD' },
        ],
      });

    expect(res.status).toBe(400);
  });

  it('rejects a malformed amount on a recurring template', async () => {
    // Isolated app for the same rate-limiter reason as above.
    const isolatedApp = createApp(testPrisma);
    const { agent, csrfToken } = await registerAgent('bad-amount-recurring@b.com', isolatedApp);
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const rentId = await categoryId(agent, 'Аренда/Жильё');

    const res = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Rent',
        accountId,
        categoryId: rentId,
        amount: '12,50',
        currency: 'USD',
        interval: 'MONTH',
        startDate: new Date().toISOString(),
      });

    expect(res.status).toBe(400);
  });

  it('updates a one-off transaction and rejects an unbalanced edit', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const salaryId = await categoryId(agent, 'Зарплата');

    const created = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Salary',
        date: new Date().toISOString(),
        entries: [
          { accountId, amount: '1000.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-1000.00', currency: 'USD' },
        ],
      });

    const updated = await agent
      .patch(`/api/transactions/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        entries: [
          { accountId, amount: '1500.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-1500.00', currency: 'USD' },
        ],
      });
    expect(updated.status).toBe(200);

    const unbalanced = await agent
      .patch(`/api/transactions/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        entries: [
          { accountId, amount: '100.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-50.00', currency: 'USD' },
        ],
      });
    expect(unbalanced.status).toBe(400);
  });

  it('updates a recurring template and can deactivate it', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const rentId = await categoryId(agent, 'Аренда/Жильё');

    const created = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Rent',
        accountId,
        categoryId: rentId,
        amount: '-1000.00',
        currency: 'USD',
        interval: 'MONTH',
        startDate: new Date().toISOString(),
      });

    const updated = await agent
      .patch(`/api/transactions/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ isActive: false });

    expect(updated.status).toBe(200);
    expect(updated.body.isActive).toBe(false);
  });

  it('deletes a one-off transaction (hard) and a recurring template (soft)', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const accountId = await createAccount(agent, csrfToken, 'Card');
    const salaryId = await categoryId(agent, 'Зарплата');
    const rentId = await categoryId(agent, 'Аренда/Жильё');

    const oneOff = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Salary',
        date: new Date().toISOString(),
        entries: [
          { accountId, amount: '1000.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-1000.00', currency: 'USD' },
        ],
      });
    const template = await agent
      .post('/api/transactions')
      .set('X-CSRF-Token', csrfToken)
      .send({
        description: 'Rent',
        accountId,
        categoryId: rentId,
        amount: '-1000.00',
        currency: 'USD',
        interval: 'MONTH',
        startDate: new Date().toISOString(),
      });

    const deletedOneOff = await agent
      .delete(`/api/transactions/${oneOff.body.id}`)
      .set('X-CSRF-Token', csrfToken);
    expect(deletedOneOff.body.hardDeleted).toBe(true);

    const deletedTemplate = await agent
      .delete(`/api/transactions/${template.body.id}`)
      .set('X-CSRF-Token', csrfToken);
    expect(deletedTemplate.body.hardDeleted).toBe(false);
  });

  it("rejects (400) a one-off transaction referencing another user's account", async () => {
    const isolatedApp = createApp(testPrisma);
    const owner = await registerAgent('owner2@b.com', isolatedApp);
    const stranger = await registerAgent('stranger2@b.com', isolatedApp);
    const strangerAccountId = await createAccount(stranger.agent, stranger.csrfToken, 'Stranger card');
    const salaryId = await categoryId(owner.agent, 'Зарплата');

    const res = await owner.agent
      .post('/api/transactions')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        description: 'Salary',
        date: new Date().toISOString(),
        entries: [
          { accountId: strangerAccountId, amount: '1000.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-1000.00', currency: 'USD' },
        ],
      });

    expect(res.status).toBe(400);
  });

  it("returns 404 deleting another user's transaction", async () => {
    // Isolated app instance so this test's two registrations don't share
    // the shared `app`'s rate limiter counter with tests 1-5 in this file
    // (same reasoning as tests/auth.routes.test.ts).
    const isolatedApp = createApp(testPrisma);
    const owner = await registerAgent('owner@b.com', isolatedApp);
    const stranger = await registerAgent('stranger@b.com', isolatedApp);
    const accountId = await createAccount(owner.agent, owner.csrfToken, 'Card');
    const salaryId = await categoryId(owner.agent, 'Зарплата');

    const created = await owner.agent
      .post('/api/transactions')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        description: 'Salary',
        date: new Date().toISOString(),
        entries: [
          { accountId, amount: '1000.00', currency: 'USD' },
          { categoryId: salaryId, amount: '-1000.00', currency: 'USD' },
        ],
      });

    const res = await stranger.agent
      .delete(`/api/transactions/${created.body.id}`)
      .set('X-CSRF-Token', stranger.csrfToken);

    expect(res.status).toBe(404);
  });
});
