import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { createTransaction } from '../src/modules/ledger/ledger.service';
import {
  seedSystemCategories,
  seedDefaultCategories,
  SYSTEM_CATEGORY_OTHER,
  SYSTEM_CATEGORY_UNREALIZED_REVALUATION,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  CategoryNotFoundError,
  SystemCategoryError,
  DuplicateCategoryNameError,
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

  it('lists only active categories by default, all when includeInactive is true', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    await testPrisma.category.create({ data: { userId: user.id, name: 'Active', kind: 'EXPENSE' } });
    await testPrisma.category.create({
      data: { userId: user.id, name: 'Inactive', kind: 'EXPENSE', isActive: false },
    });

    const activeOnly = await listCategories(testPrisma, user.id);
    expect(activeOnly.map((c) => c.name)).toEqual(['Active']);

    const all = await listCategories(testPrisma, user.id, { includeInactive: true });
    expect(all.map((c) => c.name).sort()).toEqual(['Active', 'Inactive']);
  });

  it('creates a category', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });

    const category = await createCategory(testPrisma, { userId: user.id, name: 'Hobbies', kind: 'EXPENSE' });

    expect(category.name).toBe('Hobbies');
    expect(category.isSystem).toBe(false);
  });

  it('rejects creating a duplicate category name for the same user', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    await createCategory(testPrisma, { userId: user.id, name: 'Hobbies', kind: 'EXPENSE' });

    await expect(
      createCategory(testPrisma, { userId: user.id, name: 'Hobbies', kind: 'EXPENSE' })
    ).rejects.toThrow(DuplicateCategoryNameError);
  });

  it('updates a category name', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const category = await createCategory(testPrisma, { userId: user.id, name: 'Old', kind: 'EXPENSE' });

    const updated = await updateCategory(testPrisma, {
      userId: user.id,
      categoryId: category.id,
      name: 'New',
    });

    expect(updated.name).toBe('New');
  });

  it('rejects updating a category that belongs to another user', async () => {
    const owner = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const stranger = await testPrisma.user.create({ data: { email: 'c@d.com', passwordHash: 'h' } });
    const category = await createCategory(testPrisma, { userId: owner.id, name: 'Mine', kind: 'EXPENSE' });

    await expect(
      updateCategory(testPrisma, { userId: stranger.id, categoryId: category.id, name: 'Stolen' })
    ).rejects.toThrow(CategoryNotFoundError);
  });

  it('rejects updating a system category', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    await seedSystemCategories(testPrisma, user.id);
    const other = await testPrisma.category.findFirstOrThrow({
      where: { userId: user.id, name: SYSTEM_CATEGORY_OTHER },
    });

    await expect(
      updateCategory(testPrisma, { userId: user.id, categoryId: other.id, name: 'Renamed' })
    ).rejects.toThrow(SystemCategoryError);
  });

  it('hard-deletes a category with no entries', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const category = await createCategory(testPrisma, { userId: user.id, name: 'Unused', kind: 'EXPENSE' });

    const result = await deleteCategory(testPrisma, { userId: user.id, categoryId: category.id });

    expect(result.hardDeleted).toBe(true);
    const found = await testPrisma.category.findUnique({ where: { id: category.id } });
    expect(found).toBeNull();
  });

  it('soft-deletes a category that has entries', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await testPrisma.account.create({
      data: { userId: user.id, name: 'Card', kind: 'FINANCIAL', currency: 'USD' },
    });
    const category = await createCategory(testPrisma, { userId: user.id, name: 'Used', kind: 'EXPENSE' });
    await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Spend',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '-10.00', currency: 'USD' },
        { categoryId: category.id, amount: '10.00', currency: 'USD' },
      ],
    });

    const result = await deleteCategory(testPrisma, { userId: user.id, categoryId: category.id });

    expect(result.hardDeleted).toBe(false);
    const found = await testPrisma.category.findUniqueOrThrow({ where: { id: category.id } });
    expect(found.isActive).toBe(false);
  });

  it('rejects deleting a system category', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    await seedSystemCategories(testPrisma, user.id);
    const other = await testPrisma.category.findFirstOrThrow({
      where: { userId: user.id, name: SYSTEM_CATEGORY_OTHER },
    });

    await expect(
      deleteCategory(testPrisma, { userId: user.id, categoryId: other.id })
    ).rejects.toThrow(SystemCategoryError);
  });
});
