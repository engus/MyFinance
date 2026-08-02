import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { formatDateOnly } from '../src/lib/date';
import { createAccount } from '../src/modules/accounts/accounts.service';
import { createAsset, recordValuation } from '../src/modules/assets/assets.service';
import { getDashboard } from '../src/modules/dashboard/dashboard.service';
import { createLiability } from '../src/modules/liabilities/liabilities.service';
import { createOperation } from '../src/modules/ledger/ledger.service';
import { RateService } from '../src/modules/rates/rates.service';
import { testPrisma, truncateAll } from './helpers/db';
import { seedLedgerUser } from './helpers/seed';

describe('assets, providers and dashboard reporting', () => {
  const rates = new RateService(testPrisma);
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('makes a same-source dated valuation idempotent', async () => {
    const { user } = await seedLedgerUser(testPrisma);
    const today = formatDateOnly(new Date());
    const asset = await createAsset(testPrisma, rates, user.id, {
      name: 'Apartment',
      type: 'REAL_ESTATE',
      currency: 'USD',
      initialValue: '250000',
      valuationDate: today,
      ownershipShare: '100',
    });
    const repeated = await recordValuation(testPrisma, rates, user.id, asset.id, {
      amount: '260000',
      currency: 'USD',
      date: today,
      source: 'MANUAL',
    });
    expect(repeated.amount.toString()).toBe('250000');
    expect(await testPrisma.assetValuation.count({ where: { assetId: asset.id } })).toBe(1);
    expect(
      await testPrisma.transaction.count({ where: { userId: user.id, type: 'VALUATION' } })
    ).toBe(0);
  });

  it('tracks a security as user-entered dated total-value snapshots', async () => {
    const { user } = await seedLedgerUser(testPrisma);
    const asset = await createAsset(testPrisma, rates, user.id, {
      name: 'Index funds',
      type: 'SECURITY',
      currency: 'USD',
      initialValue: '1000',
      valuationDate: '2026-07-01',
      ownershipShare: '100',
    });
    const snapshot = await recordValuation(testPrisma, rates, user.id, asset.id, {
      amount: '1125',
      currency: 'USD',
      date: '2026-08-01',
      source: 'MANUAL',
    });
    expect(snapshot.amount.toString()).toBe('1125');
    expect(await testPrisma.assetValuation.count({ where: { assetId: asset.id } })).toBe(2);
    expect(
      await testPrisma.transaction.count({ where: { userId: user.id, type: 'VALUATION' } })
    ).toBe(1);
  });

  it('excludes opening balances, transfers and unrealized valuations from monthly cashflow', async () => {
    const { user } = await seedLedgerUser(testPrisma);
    const today = formatDateOnly(new Date());
    const checking = await createAccount(testPrisma, rates, user.id, {
      name: 'Checking',
      class: 'ASSET',
      subtype: 'BANK',
      currency: 'USD',
      openingBalance: '1000',
      openingDate: today,
    });
    const savings = await createAccount(testPrisma, rates, user.id, {
      name: 'Savings',
      class: 'ASSET',
      subtype: 'BANK',
      currency: 'USD',
    });
    const liability = await createLiability(testPrisma, rates, user.id, {
      name: 'Loan',
      subtype: 'LOAN',
      currency: 'USD',
      openingBalance: '300',
      openingDate: today,
    });
    const income = await testPrisma.category.findFirstOrThrow({
      where: { userId: user.id, name: 'Salary' },
    });
    const expense = await testPrisma.category.findFirstOrThrow({
      where: { userId: user.id, name: 'Groceries' },
    });
    await createOperation(testPrisma, rates, user.id, {
      type: 'INCOME',
      description: 'Salary',
      date: today,
      accountId: checking.id,
      categoryId: income.id,
      amount: '200',
      currency: 'USD',
    });
    await createOperation(testPrisma, rates, user.id, {
      type: 'EXPENSE',
      description: 'Food',
      date: today,
      accountId: checking.id,
      categoryId: expense.id,
      amount: '50',
      currency: 'USD',
    });
    await createOperation(testPrisma, rates, user.id, {
      type: 'TRANSFER',
      description: 'Move cash',
      date: today,
      fromAccountId: checking.id,
      toAccountId: savings.id,
      fromAmount: '100',
      toAmount: '100',
    });
    await createOperation(testPrisma, rates, user.id, {
      type: 'LIABILITY_PAYMENT',
      description: 'Loan payment',
      date: today,
      cashAccountId: checking.id,
      liabilityAccountId: liability.id,
      principalAmount: '10',
      interestAmount: '2',
    });
    await createAsset(testPrisma, rates, user.id, {
      name: 'Art',
      type: 'COLLECTIBLE',
      currency: 'USD',
      initialValue: '500',
      valuationDate: today,
      ownershipShare: '100',
    });
    const dashboard = await getDashboard(testPrisma, rates, user.id);
    expect(dashboard.kpis.monthlyIncome).toBe('200');
    expect(dashboard.kpis.monthlyExpense).toBe('52');
    expect(dashboard.kpis.monthlySavings).toBe('148');
    expect(Number(dashboard.kpis.netWorth)).toBeGreaterThan(0);
  });
});
