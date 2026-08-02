import { describe, expect, it } from 'vitest';
import { createOperationSchema, dateSchema, recurrenceSchema, SUPPORTED_CURRENCIES } from './index';

describe('public contracts', () => {
  it('publishes exactly the supported 24 currencies', () => {
    expect(SUPPORTED_CURRENCIES).toHaveLength(24);
    expect(SUPPORTED_CURRENCIES).toContain('KZT');
    expect(SUPPORTED_CURRENCIES).toContain('AED');
  });
  it('keeps financial dates date-only', () => {
    expect(dateSchema.safeParse('2026-08-02').success).toBe(true);
    expect(dateSchema.safeParse('2026-08-02T12:00:00Z').success).toBe(false);
  });
  it('accepts Prisma CUID identifiers and rejects arbitrary journal entries', () => {
    expect(
      createOperationSchema.safeParse({
        type: 'EXPENSE',
        description: 'Food',
        date: '2026-08-02',
        accountId: 'cm1234567890abcdefghijk',
        categoryId: 'cm0987654321abcdefghijk',
        amount: '12.34000000',
        currency: 'USD',
      }).success
    ).toBe(true);
    expect(
      createOperationSchema.safeParse({
        type: 'EXPENSE',
        description: 'Food',
        date: '2026-08-02',
        entries: [],
      }).success
    ).toBe(false);
  });
  it('requires customDays for custom recurrence', () => {
    const operation = {
      type: 'INCOME',
      description: 'Income',
      date: '2026-08-02',
      accountId: 'cm1234567890abcdefghijk',
      categoryId: 'cm0987654321abcdefghijk',
      amount: '1',
      currency: 'USD',
    };
    expect(
      recurrenceSchema.safeParse({ operation, interval: 'CUSTOM', startDate: '2026-08-02' }).success
    ).toBe(false);
  });
});
