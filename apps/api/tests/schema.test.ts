import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';

describe('schema', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('creates a user and reads it back', async () => {
    const user = await testPrisma.user.create({
      data: { email: 'a@b.com', passwordHash: 'hash' },
    });
    const found = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(found.email).toBe('a@b.com');
    expect(found.reconciliationMode).toBe('AUTO');
  });

  it('rejects an entry with both accountId and categoryId', async () => {
    const user = await testPrisma.user.create({ data: { email: 'c@d.com', passwordHash: 'h' } });
    const account = await testPrisma.account.create({
      data: { userId: user.id, name: 'Card', kind: 'FINANCIAL', currency: 'USD' },
    });
    const category = await testPrisma.category.create({
      data: { userId: user.id, name: 'Salary', kind: 'INCOME' },
    });
    const tx = await testPrisma.transaction.create({
      data: { userId: user.id, description: 'x', date: new Date() },
    });

    await expect(
      testPrisma.entry.create({
        data: {
          transactionId: tx.id,
          accountId: account.id,
          categoryId: category.id,
          amount: '10.00',
          currency: 'USD',
        },
      })
    ).rejects.toThrow();
  });

  it('rejects deleting an account that still has entries pointing at it', async () => {
    const user = await testPrisma.user.create({ data: { email: 'e@f.com', passwordHash: 'h' } });
    const account = await testPrisma.account.create({
      data: { userId: user.id, name: 'Card', kind: 'FINANCIAL', currency: 'USD' },
    });
    const tx = await testPrisma.transaction.create({
      data: { userId: user.id, description: 'x', date: new Date() },
    });
    await testPrisma.entry.create({
      data: {
        transactionId: tx.id,
        accountId: account.id,
        amount: '10.00',
        currency: 'USD',
      },
    });

    await expect(
      testPrisma.account.delete({ where: { id: account.id } })
    ).rejects.toThrow();
  });
});
