import { Prisma, PrismaClient, RateSource } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { dateOnly } from '../../lib/date';
import { RateProvider } from './rateProvider';

export type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export interface ResolvedRate {
  rate: Prisma.Decimal;
  source: RateSource;
  date: Date;
}

export class RateService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider?: RateProvider
  ) {}

  async resolve(
    fromCurrency: string,
    toCurrency: string,
    valueDate: Date,
    manualRate?: string,
    ownerKey = 'MARKET'
  ): Promise<ResolvedRate> {
    const rateDate = dateOnly(valueDate);
    if (fromCurrency === toCurrency) {
      return { rate: new Prisma.Decimal(1), source: 'MANUAL', date: rateDate };
    }

    if (manualRate) {
      const rate = new Prisma.Decimal(manualRate);
      if (!rate.isPositive()) throw new AppError(400, 'INVALID_RATE', 'FX rate must be positive');
      await this.prisma.exchangeRate.upsert({
        where: {
          ownerKey_fromCurrency_toCurrency_rateDate_source: {
            ownerKey,
            fromCurrency,
            toCurrency,
            rateDate,
            source: 'MANUAL',
          },
        },
        create: { ownerKey, fromCurrency, toCurrency, rateDate, source: 'MANUAL', rate },
        update: { rate, fetchedAt: new Date() },
      });
      return { rate, source: 'MANUAL', date: rateDate };
    }

    const manual = await this.prisma.exchangeRate.findFirst({
      where: { ownerKey, fromCurrency, toCurrency, source: 'MANUAL', rateDate },
    });
    if (manual) return { rate: manual.rate, source: manual.source, date: manual.rateDate };

    if (this.provider) {
      try {
        const fetched = new Prisma.Decimal(
          await this.provider.getRate(fromCurrency, toCurrency, rateDate)
        );
        const saved = await this.prisma.exchangeRate.upsert({
          where: {
            ownerKey_fromCurrency_toCurrency_rateDate_source: {
              ownerKey: 'MARKET',
              fromCurrency,
              toCurrency,
              rateDate,
              source: 'YAHOO',
            },
          },
          create: {
            ownerKey: 'MARKET',
            fromCurrency,
            toCurrency,
            rateDate,
            source: 'YAHOO',
            rate: fetched,
          },
          update: { rate: fetched, fetchedAt: new Date() },
        });
        return { rate: saved.rate, source: saved.source, date: saved.rateDate };
      } catch {
        // Fall through to the stale-cache path.
      }
    }

    const [ownedCached, marketCached] = await Promise.all([
      ownerKey === 'MARKET'
        ? null
        : this.prisma.exchangeRate.findFirst({
            where: {
              ownerKey,
              fromCurrency,
              toCurrency,
              source: 'MANUAL',
              rateDate: { lte: rateDate },
            },
            orderBy: { rateDate: 'desc' },
          }),
      this.prisma.exchangeRate.findFirst({
        where: { ownerKey: 'MARKET', fromCurrency, toCurrency, rateDate: { lte: rateDate } },
        orderBy: { rateDate: 'desc' },
      }),
    ]);
    const cached =
      ownedCached && (!marketCached || ownedCached.rateDate >= marketCached.rateDate)
        ? ownedCached
        : marketCached;
    if (cached) return { rate: cached.rate, source: cached.source, date: cached.rateDate };

    throw new AppError(
      422,
      'RATE_REQUIRED',
      `No ${fromCurrency}/${toCurrency} rate is available; enter a manual rate`
    );
  }
}
