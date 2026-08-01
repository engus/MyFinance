import { PrismaClient, Prisma } from '@prisma/client';
import { RateProvider } from './rateProvider';

const CACHE_TTL_MS = 1000 * 60 * 60;

export async function getCachedRate(
  prisma: PrismaClient,
  provider: RateProvider,
  fromSymbol: string,
  toSymbol: string
): Promise<Prisma.Decimal> {
  if (fromSymbol === toSymbol) return new Prisma.Decimal(1);

  const cached = await prisma.exchangeRate.findUnique({
    where: { fromSymbol_toSymbol: { fromSymbol, toSymbol } },
  });
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return cached.rate;
  }

  try {
    const rate = await provider.getRate(fromSymbol, toSymbol);
    const saved = await prisma.exchangeRate.upsert({
      where: { fromSymbol_toSymbol: { fromSymbol, toSymbol } },
      create: { fromSymbol, toSymbol, rate },
      update: { rate, fetchedAt: new Date() },
    });
    return saved.rate;
  } catch (err) {
    if (cached) return cached.rate;
    throw err;
  }
}
