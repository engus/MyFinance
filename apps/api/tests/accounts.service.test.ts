import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { createAccount, listAccountsWithBalances } from '../src/modules/accounts/accounts.service';
import { createTransaction } from '../src/modules/ledger/ledger.service';

describe('accounts.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('creates an account and lists it with a computed balance', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Checking',
      kind: 'FINANCIAL',
      currency: 'USD',
    });
    const category = await testPrisma.category.create({
      data: { userId: user.id, name: 'Salary', kind: 'INCOME' },
    });

    await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Salary',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '500.00', currency: 'USD' },
        { categoryId: category.id, amount: '-500.00', currency: 'USD' },
      ],
    });

    const accounts = await listAccountsWithBalances(testPrisma, user.id);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Checking');
    expect(accounts[0].balance).toBe('500');
  });
});
