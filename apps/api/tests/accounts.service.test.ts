import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import {
  createAccount,
  listAccountsWithBalances,
  updateAccount,
  deleteAccount,
  AccountNotFoundError,
} from '../src/modules/accounts/accounts.service';
import { createTransaction } from '../src/modules/ledger/ledger.service';
import { createRecurringTemplate } from '../src/modules/transactions/transactions.service';

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

  it('updates an account name', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Old name',
      kind: 'FINANCIAL',
      currency: 'USD',
    });

    const updated = await updateAccount(testPrisma, {
      userId: user.id,
      accountId: account.id,
      name: 'New name',
    });

    expect(updated.name).toBe('New name');
  });

  it('rejects updating an account that belongs to another user', async () => {
    const owner = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const stranger = await testPrisma.user.create({ data: { email: 'c@d.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: owner.id,
      name: 'Mine',
      kind: 'FINANCIAL',
      currency: 'USD',
    });

    await expect(
      updateAccount(testPrisma, { userId: stranger.id, accountId: account.id, name: 'Stolen' })
    ).rejects.toThrow(AccountNotFoundError);
  });

  it('hard-deletes an account with no entries', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Unused',
      kind: 'FINANCIAL',
      currency: 'USD',
    });

    const result = await deleteAccount(testPrisma, { userId: user.id, accountId: account.id });

    expect(result.hardDeleted).toBe(true);
    const found = await testPrisma.account.findUnique({ where: { id: account.id } });
    expect(found).toBeNull();
  });

  it('refuses to hard-delete an account referenced only by a never-yet-generated recurring template', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Card',
      kind: 'FINANCIAL',
      currency: 'USD',
    });
    const category = await testPrisma.category.create({
      data: { userId: user.id, name: 'Rent', kind: 'EXPENSE' },
    });
    await createRecurringTemplate(testPrisma, {
      userId: user.id,
      description: 'Rent',
      accountId: account.id,
      categoryId: category.id,
      amount: '-1000.00',
      currency: 'USD',
      interval: 'MONTH',
      startDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    const result = await deleteAccount(testPrisma, { userId: user.id, accountId: account.id });

    expect(result.hardDeleted).toBe(false);
    const found = await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(found.isActive).toBe(false);
  });

  it('soft-deletes an account that has entries, and it disappears from listAccountsWithBalances', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Used',
      kind: 'FINANCIAL',
      currency: 'USD',
    });
    const category = await testPrisma.category.create({
      data: { userId: user.id, name: 'Salary', kind: 'INCOME' },
    });
    await createTransaction(testPrisma, {
      userId: user.id,
      description: 'Pay',
      date: new Date(),
      entries: [
        { accountId: account.id, amount: '10.00', currency: 'USD' },
        { categoryId: category.id, amount: '-10.00', currency: 'USD' },
      ],
    });

    const result = await deleteAccount(testPrisma, { userId: user.id, accountId: account.id });

    expect(result.hardDeleted).toBe(false);
    const found = await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(found.isActive).toBe(false);

    const active = await listAccountsWithBalances(testPrisma, user.id);
    expect(active).toHaveLength(0);
  });
});
