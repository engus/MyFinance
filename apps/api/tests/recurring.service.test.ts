import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { advance, generateDueOccurrences } from '../src/modules/recurring/recurring.service';
import { getAccountBalance } from '../src/modules/ledger/ledger.service';

describe('advance', () => {
  it('adds 7 days for WEEK', () => {
    const result = advance(new Date('2026-07-01T00:00:00Z'), 'WEEK');
    expect(result.toISOString()).toBe('2026-07-08T00:00:00.000Z');
  });

  it('adds a calendar month for MONTH', () => {
    const result = advance(new Date('2026-07-15T00:00:00Z'), 'MONTH');
    expect(result.toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('clamps to month end for MONTH when the day does not exist in the next month', () => {
    const result = advance(new Date('2026-01-31T00:00:00Z'), 'MONTH');
    expect(result.toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('adds 3 calendar months for QUARTER', () => {
    const result = advance(new Date('2026-01-31T00:00:00Z'), 'QUARTER');
    expect(result.toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('adds a calendar year for YEAR', () => {
    const result = advance(new Date('2026-02-28T00:00:00Z'), 'YEAR');
    expect(result.toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });

  it('adds customDays for CUSTOM', () => {
    const result = advance(new Date('2026-07-01T00:00:00Z'), 'CUSTOM', 10);
    expect(result.toISOString()).toBe('2026-07-11T00:00:00.000Z');
  });

  it('throws for CUSTOM without customDays', () => {
    expect(() => advance(new Date('2026-07-01T00:00:00Z'), 'CUSTOM')).toThrow();
  });
});

describe('generateDueOccurrences', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  async function seedTemplate(
    nextRunDate: Date,
    overrides: Partial<{ isActive: boolean }> = {}
  ) {
    const user = await testPrisma.user.create({ data: { email: 'a@b.com', passwordHash: 'h' } });
    const account = await testPrisma.account.create({
      data: { userId: user.id, name: 'Card', kind: 'FINANCIAL', currency: 'USD' },
    });
    const category = await testPrisma.category.create({
      data: { userId: user.id, name: 'Rent', kind: 'EXPENSE' },
    });
    const template = await testPrisma.transaction.create({
      data: {
        userId: user.id,
        description: 'Rent',
        date: nextRunDate,
        frequency: 'RECURRING',
        interval: 'MONTH',
        nextRunDate,
        isActive: overrides.isActive ?? true,
        templateAccountId: account.id,
        templateCategoryId: category.id,
        templateAmount: '-1000.00',
        templateCurrency: 'USD',
      },
    });
    return { user, account, category, template };
  }

  it('generates one occurrence when exactly one period is due', async () => {
    const { user, account, template } = await seedTemplate(new Date('2020-01-01T00:00:00Z'));
    // A single explicit MONTH occurrence, isolated from the "many periods due" case below
    // by advancing nextRunDate to just before "now" first.
    const almostNow = new Date();
    almostNow.setUTCDate(almostNow.getUTCDate() - 1);
    await testPrisma.transaction.update({
      where: { id: template.id },
      data: { nextRunDate: almostNow },
    });

    const generated = await generateDueOccurrences(testPrisma, user.id);

    expect(generated).toHaveLength(1);
    expect(generated[0].templateId).toBe(template.id);
    const balance = await getAccountBalance(testPrisma, account.id);
    expect(balance.toString()).toBe('-1000');
  });

  it('catches up every missed period in one call', async () => {
    const { user, account } = await seedTemplate(new Date('2020-01-01T00:00:00Z'));

    const generated = await generateDueOccurrences(testPrisma, user.id);

    expect(generated.length).toBeGreaterThan(1);
    const balance = await getAccountBalance(testPrisma, account.id);
    expect(balance.toNumber()).toBe(-1000 * generated.length);
  });

  it('does not double-post when called twice in a row', async () => {
    const { user } = await seedTemplate(new Date('2020-01-01T00:00:00Z'));

    await generateDueOccurrences(testPrisma, user.id);
    const second = await generateDueOccurrences(testPrisma, user.id);

    expect(second).toHaveLength(0);
  });

  it('skips inactive templates', async () => {
    const { user } = await seedTemplate(new Date('2020-01-01T00:00:00Z'), { isActive: false });

    const generated = await generateDueOccurrences(testPrisma, user.id);

    expect(generated).toHaveLength(0);
  });

  it('does nothing for a template not yet due', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
    const { user } = await seedTemplate(future);

    const generated = await generateDueOccurrences(testPrisma, user.id);

    expect(generated).toHaveLength(0);
  });
});
