import { Prisma, PrismaClient } from '@prisma/client';
import { formatDateOnly } from '../../lib/date';
import { AppError } from '../../lib/errors';
import { RateService } from '../rates/rates.service';

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, count: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

function monthEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export async function getDashboard(prisma: PrismaClient, rates: RateService, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  const settings = user;
  const now = new Date();
  const start = addMonths(monthStart(now), -11);
  const [accounts, accountEntries, categoryEntries, historicAccountEntries] = await Promise.all([
    prisma.account.findMany({ where: { userId, isSystem: false } }),
    prisma.entry.findMany({
      where: { account: { userId, isSystem: false }, transaction: { occurredOn: { lte: now } } },
      select: { accountId: true, originalAmount: true },
    }),
    prisma.entry.findMany({
      where: {
        category: { userId, affectsCashflow: true },
        transaction: { occurredOn: { gte: start, lte: now } },
      },
      include: { category: true, transaction: { select: { occurredOn: true } } },
    }),
    prisma.entry.findMany({
      where: { account: { userId, isSystem: false }, transaction: { occurredOn: { lte: now } } },
      include: { transaction: { select: { occurredOn: true } } },
    }),
  ]);

  const originalBalances = new Map<string, Prisma.Decimal>();
  for (const entry of accountEntries) {
    if (!entry.accountId) continue;
    originalBalances.set(
      entry.accountId,
      (originalBalances.get(entry.accountId) ?? new Prisma.Decimal(0)).add(entry.originalAmount)
    );
  }

  const rateCache = new Map<string, Prisma.Decimal>();
  const missingRates = new Set<string>();
  async function convert(amount: Prisma.Decimal, from: string, date: Date) {
    if (from === settings.displayCurrency) return amount;
    const key = `${from}:${settings.displayCurrency}:${formatDateOnly(date)}`;
    let rate = rateCache.get(key);
    if (!rate) {
      try {
        rate = (await rates.resolve(from, settings.displayCurrency, date, undefined, userId)).rate;
        rateCache.set(key, rate);
      } catch (error) {
        if (error instanceof AppError && error.code === 'RATE_REQUIRED') {
          missingRates.add(`${from}/${settings.displayCurrency}`);
          return null;
        }
        throw error;
      }
    }
    return amount.mul(rate).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);
  }

  let assets = new Prisma.Decimal(0);
  let liabilities = new Prisma.Decimal(0);
  let cash = new Prisma.Decimal(0);
  const allocation = new Map<string, Prisma.Decimal>();
  const exposure = new Map<string, Prisma.Decimal>();
  for (const account of accounts) {
    const balance = originalBalances.get(account.id) ?? new Prisma.Decimal(0);
    const converted = await convert(balance, account.currency, now);
    if (!converted) continue;
    if (account.class === 'ASSET') {
      assets = assets.add(converted);
      allocation.set(
        account.subtype,
        (allocation.get(account.subtype) ?? new Prisma.Decimal(0)).add(converted.abs())
      );
      exposure.set(
        account.currency,
        (exposure.get(account.currency) ?? new Prisma.Decimal(0)).add(converted)
      );
      if (account.subtype === 'BANK' || account.subtype === 'CASH') cash = cash.add(converted);
    } else if (account.class === 'LIABILITY') {
      liabilities = liabilities.add(converted.abs());
    }
  }

  const months = Array.from({ length: 12 }, (_, index) => addMonths(start, index));
  const cashflow = [];
  const netWorthHistory = [];
  for (const month of months) {
    const key = formatDateOnly(month).slice(0, 7);
    let incomeReport = new Prisma.Decimal(0);
    let expenseReport = new Prisma.Decimal(0);
    let flowRateMissing = false;
    for (const entry of categoryEntries) {
      if (formatDateOnly(entry.transaction.occurredOn).slice(0, 7) !== key || !entry.category)
        continue;
      const converted = await convert(
        entry.functionalAmount.abs(),
        settings.functionalCurrency,
        entry.transaction.occurredOn
      );
      if (!converted) {
        flowRateMissing = true;
        continue;
      }
      if (entry.category.kind === 'INCOME') incomeReport = incomeReport.add(converted);
      else expenseReport = expenseReport.add(converted);
    }
    const income = flowRateMissing ? null : incomeReport;
    const expense = flowRateMissing ? null : expenseReport;
    cashflow.push({
      month: key,
      income: income?.toString() ?? null,
      expense: expense?.toString() ?? null,
      savings: income && expense ? income.sub(expense).toString() : null,
    });

    const reportDate = monthEnd(month);
    const functionalNetWorth = historicAccountEntries
      .filter((entry) => entry.transaction.occurredOn <= reportDate)
      .reduce((sum, entry) => sum.add(entry.functionalAmount), new Prisma.Decimal(0));
    const netWorth = await convert(functionalNetWorth, settings.functionalCurrency, reportDate);
    netWorthHistory.push({ month: key, value: netWorth?.toString() ?? null });
  }

  const current = cashflow.at(-1) ?? { income: '0', expense: '0', savings: '0' };
  return {
    currency: settings.displayCurrency,
    generatedAt: now.toISOString(),
    kpis: {
      netWorth: assets.sub(liabilities).toString(),
      assets: assets.toString(),
      liabilities: liabilities.toString(),
      cash: cash.toString(),
      monthlyIncome: current.income,
      monthlyExpense: current.expense,
      monthlySavings: current.savings,
    },
    cashflow,
    netWorthHistory,
    assetAllocation: [...allocation].map(([label, value]) => ({ label, value: value.toString() })),
    currencyExposure: [...exposure].map(([currency, value]) => ({
      currency,
      value: value.toString(),
    })),
    missingRates: [...missingRates],
  };
}
