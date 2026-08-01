import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import { getCachedRate } from '../src/modules/rates/rates.service';
import type { RateProvider } from '../src/modules/rates/rateProvider';

describe('rates.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('returns 1 for identical symbols without calling the provider', async () => {
    const provider: RateProvider = { getRate: vi.fn() };
    const rate = await getCachedRate(testPrisma, provider, 'USD', 'USD');
    expect(rate.toString()).toBe('1');
    expect(provider.getRate).not.toHaveBeenCalled();
  });

  it('fetches from the provider and caches the result', async () => {
    const getRate = vi.fn().mockResolvedValue(1.1);
    const provider: RateProvider = { getRate };

    const first = await getCachedRate(testPrisma, provider, 'USD', 'EUR');
    expect(first.toNumber()).toBeCloseTo(1.1);
    expect(getRate).toHaveBeenCalledTimes(1);

    const second = await getCachedRate(testPrisma, provider, 'USD', 'EUR');
    expect(second.toNumber()).toBeCloseTo(1.1);
    expect(getRate).toHaveBeenCalledTimes(1);
  });

  it('falls back to a stale cached rate if the provider call fails', async () => {
    const getRate = vi.fn().mockResolvedValueOnce(1.2).mockRejectedValueOnce(new Error('network down'));
    const provider: RateProvider = { getRate };

    await getCachedRate(testPrisma, provider, 'USD', 'EUR');
    await testPrisma.exchangeRate.updateMany({
      where: { fromSymbol: 'USD', toSymbol: 'EUR' },
      data: { fetchedAt: new Date(Date.now() - 1000 * 60 * 60 * 2) },
    });

    const rate = await getCachedRate(testPrisma, provider, 'USD', 'EUR');
    expect(rate.toNumber()).toBeCloseTo(1.2);
  });
});
