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

describe('categories routes', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('lists the default categories seeded at registration', async () => {
    const { agent } = await registerAgent('a@b.com');

    const res = await agent.get('/api/categories');

    expect(res.status).toBe(200);
    // Registration seeds 2 system categories + 10 default categories = 12
    // (see task-5-brief.md / task-5-report.md: "a freshly registered user has
    // 12 categories total"). listCategories filters on isActive only, not
    // isSystem, so both system categories are included in the default listing.
    expect(res.body).toHaveLength(12);
  });

  it('creates, updates, and deletes a category', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');

    const created = await agent
      .post('/api/categories')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Hobbies', kind: 'EXPENSE' });
    expect(created.status).toBe(201);

    const updated = await agent
      .patch(`/api/categories/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Renamed' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Renamed');

    const deleted = await agent
      .delete(`/api/categories/${created.body.id}`)
      .set('X-CSRF-Token', csrfToken);
    expect(deleted.status).toBe(200);
    expect(deleted.body.hardDeleted).toBe(true);
  });

  it('rejects a duplicate category name with 409', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    await agent.post('/api/categories').set('X-CSRF-Token', csrfToken).send({ name: 'Hobbies', kind: 'EXPENSE' });

    const res = await agent
      .post('/api/categories')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Hobbies', kind: 'EXPENSE' });

    expect(res.status).toBe(409);
  });

  it('rejects editing a system category with 403', async () => {
    const { agent, csrfToken } = await registerAgent('a@b.com');
    const categories = await agent.get('/api/categories?includeInactive=true');
    const other = categories.body.find((c: { name: string }) => c.name === 'Other');

    const res = await agent
      .patch(`/api/categories/${other.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Renamed' });

    expect(res.status).toBe(403);
  });
});
