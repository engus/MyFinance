import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { seedSystemCategories, SYSTEM_CATEGORY_OTHER } from '../src/modules/categories/categories.service';
import { createAccount } from '../src/modules/accounts/accounts.service';
import { getAccountBalance } from '../src/modules/ledger/ledger.service';
import {
  computeReconciliationDelta,
  applyReconciliation,
} from '../src/modules/reconciliation/reconciliation.service';

describe('reconciliation.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('computes zero delta when the stated balance matches the ledger', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Cash',
      kind: 'FINANCIAL',
      currency: 'USD',
    });

    const delta = await computeReconciliationDelta(testPrisma, account.id, '0');
    expect(delta.toString()).toBe('0');
  });

  it('posts the delta to the Other category when applying', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    await seedSystemCategories(testPrisma, user.id);
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Cash',
      kind: 'FINANCIAL',
      currency: 'USD',
    });

    const result = await applyReconciliation(testPrisma, {
      userId: user.id,
      accountId: account.id,
      newBalance: '200.00',
      date: new Date(),
    });

    expect(result.applied).toBe(true);
    expect(result.delta.toString()).toBe('200');

    const balance = await getAccountBalance(testPrisma, account.id);
    expect(balance.toString()).toBe('200');

    const otherCategory = await testPrisma.category.findFirstOrThrow({
      where: { userId: user.id, name: SYSTEM_CATEGORY_OTHER },
    });
    const otherEntries = await testPrisma.entry.findMany({ where: { categoryId: otherCategory.id } });
    expect(otherEntries).toHaveLength(1);
    expect(otherEntries[0].amount.toString()).toBe('-200');
  });

  it('does not create a transaction when the delta is zero', async () => {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    await seedSystemCategories(testPrisma, user.id);
    const account = await createAccount(testPrisma, {
      userId: user.id,
      name: 'Cash',
      kind: 'FINANCIAL',
      currency: 'USD',
    });

    const result = await applyReconciliation(testPrisma, {
      userId: user.id,
      accountId: account.id,
      newBalance: '0',
      date: new Date(),
    });

    expect(result.applied).toBe(false);
    const count = await testPrisma.transaction.count({ where: { userId: user.id } });
    expect(count).toBe(0);
  });
});
