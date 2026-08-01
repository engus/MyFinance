import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import {
  createTransaction,
  getAccountBalance,
  UnbalancedTransactionError,
  InvalidEntryError,
} from '../src/modules/ledger/ledger.service';

describe('ledger.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  async function seedUserWithAccountAndCategory() {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await testPrisma.account.create({
      data: { userId: user.id, name: 'Card', kind: 'FINANCIAL', currency: 'USD' },
    });
    const category = await testPrisma.category.create({
      data: { userId: user.id, name: 'Salary', kind: 'INCOME' },
    });
    return { user, account, category };
  }

  it('creates a balanced transaction and updates the account balance', async () => {
    const { user, account, category } = await seedUserWithAccountAndCategory();

    await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Salary payment',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '1000.00', currency: 'USD' },
        { categoryId: category.id, amount: '-1000.00', currency: 'USD' },
      ],
    });

    const balance = await getAccountBalance(testPrisma, account.id);
    expect(balance.toString()).toBe('1000');
  });

  it('rejects a transaction whose entries do not sum to zero', async () => {
    const { user, account, category } = await seedUserWithAccountAndCategory();

    await expect(
      createTransaction(testPrisma, {
        userId: user.id,
        description: 'Broken',
        date: new Date(),
        entries: [
          { accountId: account.id, amount: '100.00', currency: 'USD' },
          { categoryId: category.id, amount: '-50.00', currency: 'USD' },
        ],
      })
    ).rejects.toThrow(UnbalancedTransactionError);
  });

  it('rejects an entry that references both an account and a category', async () => {
    const { user, account, category } = await seedUserWithAccountAndCategory();

    await expect(
      createTransaction(testPrisma, {
        userId: user.id,
        description: 'Broken',
        date: new Date(),
        entries: [
          { accountId: account.id, categoryId: category.id, amount: '0.00', currency: 'USD' },
          { categoryId: category.id, amount: '0.00', currency: 'USD' },
        ],
      })
    ).rejects.toThrow(InvalidEntryError);
  });
});
