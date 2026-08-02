import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import {
  seedSystemCategories,
  seedDefaultCategories,
  SYSTEM_CATEGORY_OTHER,
  SYSTEM_CATEGORY_UNREALIZED_REVALUATION,
} from '../src/modules/categories/categories.service';

describe('categories.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('creates the two system categories for a new user', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });

    await seedSystemCategories(testPrisma, user.id);

    const categories = await testPrisma.category.findMany({ where: { userId: user.id } });
    const names = categories.map((c) => c.name).sort();
    expect(names).toEqual([SYSTEM_CATEGORY_OTHER, SYSTEM_CATEGORY_UNREALIZED_REVALUATION].sort());
    expect(categories.every((c) => c.isSystem)).toBe(true);
  });

  it('creates 10 default categories for a new user', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });

    await seedDefaultCategories(testPrisma, user.id);

    const categories = await testPrisma.category.findMany({ where: { userId: user.id } });
    expect(categories).toHaveLength(10);
    expect(categories.every((c) => c.isSystem === false)).toBe(true);
    const income = categories.filter((c) => c.kind === 'INCOME');
    const expense = categories.filter((c) => c.kind === 'EXPENSE');
    expect(income).toHaveLength(2);
    expect(expense).toHaveLength(8);
  });
});
