import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RateService } from '../src/modules/rates/rates.service';
import { createAccount, updateAccount } from '../src/modules/accounts/accounts.service';
import {
  createOperation,
  getAccountBalance,
  reverseTransaction,
} from '../src/modules/ledger/ledger.service';
import { testPrisma, truncateAll } from './helpers/db';
import { seedLedgerUser } from './helpers/seed';

describe('immutable ledger integrity', () => {
  const rates = new RateService(testPrisma);
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('posts only balanced functional journals and preserves decimal strings', async () => {
    const { user } = await seedLedgerUser(testPrisma);
    const account = await createAccount(testPrisma, rates, user.id, {
      name: 'Checking',
      class: 'ASSET',
      subtype: 'BANK',
      currency: 'USD',
      openingBalance: '1000.12345678',
      openingDate: '2026-08-01',
    });
    const category = await testPrisma.category.findFirstOrThrow({
      where: { userId: user.id, name: 'Groceries' },
    });
    for (const amount of ['0.00000001', '42.17000000', '999.99999999']) {
      await createOperation(testPrisma, rates, user.id, {
        type: 'EXPENSE',
        description: `Expense ${amount}`,
        date: '2026-08-02',
        accountId: account.id,
        categoryId: category.id,
        amount,
        currency: 'USD',
      });
    }
    const journals = await testPrisma.transaction.findMany({
      where: { userId: user.id },
      include: { entries: true },
    });
    expect(journals.length).toBe(4);
    for (const journal of journals) {
      expect(journal.entries.length).toBeGreaterThanOrEqual(2);
      expect(
        journal.entries
          .reduce(
            (sum, entry) => sum.add(entry.functionalAmount),
            journal.entries[0]!.functionalAmount.mul(0)
          )
          .equals(0)
      ).toBe(true);
    }
    expect((await getAccountBalance(testPrisma, account.id)).toFixed(8)).toBe('-42.04654322');
  });

  it('locks account currency after its first posting', async () => {
    const { user } = await seedLedgerUser(testPrisma);
    const account = await createAccount(testPrisma, rates, user.id, {
      name: 'Cash',
      class: 'ASSET',
      subtype: 'CASH',
      currency: 'USD',
      openingBalance: '5',
      openingDate: '2026-08-01',
    });
    await expect(
      updateAccount(testPrisma, user.id, account.id, { currency: 'EUR' })
    ).rejects.toMatchObject({ code: 'ACCOUNT_CURRENCY_LOCKED', status: 409 });
  });

  it('reverses instead of deleting and prevents a second reversal', async () => {
    const { user } = await seedLedgerUser(testPrisma);
    const account = await createAccount(testPrisma, rates, user.id, {
      name: 'Cash',
      class: 'ASSET',
      subtype: 'CASH',
      currency: 'USD',
    });
    const category = await testPrisma.category.findFirstOrThrow({
      where: { userId: user.id, name: 'Salary' },
    });
    const original = await createOperation(testPrisma, rates, user.id, {
      type: 'INCOME',
      description: 'Salary',
      date: '2026-08-01',
      accountId: account.id,
      categoryId: category.id,
      amount: '500',
      currency: 'USD',
    });
    const reversal = await reverseTransaction(testPrisma, user.id, original.id);
    expect(reversal.reversalOfId).toBe(original.id);
    expect(await testPrisma.transaction.count({ where: { userId: user.id } })).toBe(2);
    expect((await getAccountBalance(testPrisma, account.id)).equals(0)).toBe(true);
    await expect(reverseTransaction(testPrisma, user.id, original.id)).rejects.toMatchObject({
      code: 'ALREADY_REVERSED',
    });
  });

  it('isolates account ownership', async () => {
    const { user: owner } = await seedLedgerUser(testPrisma, 'owner@example.com');
    const { user: stranger } = await seedLedgerUser(testPrisma, 'stranger@example.com');
    const account = await createAccount(testPrisma, rates, owner.id, {
      name: 'Private',
      class: 'ASSET',
      subtype: 'BANK',
      currency: 'USD',
    });
    const category = await testPrisma.category.findFirstOrThrow({
      where: { userId: stranger.id, name: 'Salary' },
    });
    await expect(
      createOperation(testPrisma, rates, stranger.id, {
        type: 'INCOME',
        description: 'Intrusion',
        date: '2026-08-01',
        accountId: account.id,
        categoryId: category.id,
        amount: '10',
        currency: 'USD',
      })
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });
});
