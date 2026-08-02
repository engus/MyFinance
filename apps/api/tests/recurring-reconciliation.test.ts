import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RateService } from '../src/modules/rates/rates.service';
import { createAccount, updateAccount } from '../src/modules/accounts/accounts.service';
import { createOperation } from '../src/modules/ledger/ledger.service';
import {
  createRecurringTemplate,
  advance,
  generateDueOccurrences,
} from '../src/modules/recurring/recurring.service';
import {
  confirmReconciliation,
  previewReconciliation,
} from '../src/modules/reconciliation/reconciliation.service';
import { testPrisma, truncateAll } from './helpers/db';
import { seedLedgerUser } from './helpers/seed';

describe('recurring generation and reconciliation', () => {
  const rates = new RateService(testPrisma);
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('preserves calendar edges when advancing monthly', () => {
    expect(advance(new Date('2024-01-31T00:00:00Z'), 'MONTH').toISOString().slice(0, 10)).toBe(
      '2024-02-29'
    );
    expect(advance(new Date('2025-01-31T00:00:00Z'), 'MONTH').toISOString().slice(0, 10)).toBe(
      '2025-02-28'
    );
  });

  it('does not duplicate an occurrence under parallel generation', async () => {
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
    await createRecurringTemplate(testPrisma, rates, user.id, {
      operation: {
        type: 'INCOME',
        description: 'Monthly salary',
        date: '2026-08-01',
        accountId: account.id,
        categoryId: category.id,
        amount: '100',
        currency: 'USD',
      },
      interval: 'MONTH',
      startDate: '2026-08-01',
    });
    await Promise.all([
      generateDueOccurrences(testPrisma, rates, user.id, {
        through: new Date('2026-08-01T00:00:00Z'),
      }),
      generateDueOccurrences(testPrisma, rates, user.id, {
        through: new Date('2026-08-01T00:00:00Z'),
      }),
    ]);
    expect(await testPrisma.recurringOccurrence.count()).toBe(1);
    expect(await testPrisma.transaction.count({ where: { userId: user.id } })).toBe(1);
  });

  it('pauses related templates when an account is archived', async () => {
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
    const template = await createRecurringTemplate(testPrisma, rates, user.id, {
      operation: {
        type: 'INCOME',
        description: 'Salary',
        date: '2026-08-01',
        accountId: account.id,
        categoryId: category.id,
        amount: '10',
        currency: 'USD',
      },
      interval: 'MONTH',
      startDate: '2026-08-01',
    });
    await updateAccount(testPrisma, user.id, account.id, { isArchived: true });
    expect(
      (await testPrisma.recurringTemplate.findUniqueOrThrow({ where: { id: template.id } })).status
    ).toBe('PAUSED');
  });

  it('rejects a stale confirmation after the account changes', async () => {
    const { user } = await seedLedgerUser(testPrisma, 'confirm@example.com', {
      reconciliationMode: 'CONFIRM',
    });
    const account = await createAccount(testPrisma, rates, user.id, {
      name: 'Checking',
      class: 'ASSET',
      subtype: 'BANK',
      currency: 'USD',
      openingBalance: '100',
      openingDate: '2026-08-01',
    });
    const preview = await previewReconciliation(testPrisma, rates, user.id, {
      accountId: account.id,
      statedBalance: '100',
      date: '2026-08-02',
    });
    const category = await testPrisma.category.findFirstOrThrow({
      where: { userId: user.id, name: 'Salary' },
    });
    await createOperation(testPrisma, rates, user.id, {
      type: 'INCOME',
      description: 'Late posting',
      date: '2026-08-02',
      accountId: account.id,
      categoryId: category.id,
      amount: '1',
      currency: 'USD',
    });
    await expect(
      confirmReconciliation(testPrisma, rates, user.id, preview.id)
    ).rejects.toMatchObject({ code: 'RECONCILIATION_STALE', status: 409 });
  });

  it('routes a positive reconciliation delta to Other income', async () => {
    const { user } = await seedLedgerUser(testPrisma, 'income@example.com', {
      reconciliationMode: 'CONFIRM',
    });
    const account = await createAccount(testPrisma, rates, user.id, {
      name: 'Checking',
      class: 'ASSET',
      subtype: 'BANK',
      currency: 'USD',
    });
    const preview = await previewReconciliation(testPrisma, rates, user.id, {
      accountId: account.id,
      statedBalance: '25',
      date: '2026-08-02',
    });
    await confirmReconciliation(testPrisma, rates, user.id, preview.id);
    const entry = await testPrisma.entry.findFirstOrThrow({
      where: {
        transaction: { description: 'Balance reconciliation' },
        category: { systemKey: 'OTHER_INCOME' },
      },
    });
    expect(entry.originalAmount.toString()).toBe('-25');
  });
});
