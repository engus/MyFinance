import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { createSession, getSession, destroySession } from '../src/lib/session';

describe('session', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('creates a session and can look it up by the returned token', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const created = await createSession(testPrisma, user.id);

    const found = await getSession(testPrisma, created.token);
    expect(found).not.toBeNull();
    expect(found?.userId).toBe(user.id);
    expect(found?.csrfToken).toBe(created.csrfToken);
  });

  it('returns null for an unknown token', async () => {
    const found = await getSession(testPrisma, 'not-a-real-token');
    expect(found).toBeNull();
  });

  it('destroySession invalidates the token', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const created = await createSession(testPrisma, user.id);

    await destroySession(testPrisma, created.token);

    const found = await getSession(testPrisma, created.token);
    expect(found).toBeNull();
  });
});
