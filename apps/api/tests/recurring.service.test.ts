import { describe, it, expect } from 'vitest';
import { advance } from '../src/modules/recurring/recurring.service';

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
