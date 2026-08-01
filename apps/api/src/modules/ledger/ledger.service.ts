import { PrismaClient, Prisma } from '@prisma/client';

export interface EntryInput {
  accountId?: string;
  categoryId?: string;
  amount: string;
  currency: string;
}

export interface CreateTransactionInput {
  userId: string;
  description: string;
  date: Date;
  entries: [EntryInput, EntryInput];
  frequency?: 'ONE_OFF' | 'RECURRING';
  interval?: 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM';
  customDays?: number;
}

export class UnbalancedTransactionError extends Error {}
export class InvalidEntryError extends Error {}

export async function createTransaction(prisma: PrismaClient, input: CreateTransactionInput) {
  for (const entry of input.entries) {
    const hasAccount = Boolean(entry.accountId);
    const hasCategory = Boolean(entry.categoryId);
    if (hasAccount === hasCategory) {
      throw new InvalidEntryError('Entry must reference exactly one of accountId or categoryId');
    }
  }

  const sum = input.entries.reduce(
    (acc, e) => acc.plus(new Prisma.Decimal(e.amount)),
    new Prisma.Decimal(0)
  );
  if (!sum.equals(0)) {
    throw new UnbalancedTransactionError(`Entries must sum to zero, got ${sum.toString()}`);
  }

  return prisma.transaction.create({
    data: {
      userId: input.userId,
      description: input.description,
      date: input.date,
      frequency: input.frequency ?? 'ONE_OFF',
      interval: input.interval,
      customDays: input.customDays,
      entries: {
        create: input.entries.map((e) => ({
          accountId: e.accountId,
          categoryId: e.categoryId,
          amount: e.amount,
          currency: e.currency,
        })),
      },
    },
    include: { entries: true },
  });
}

export async function getAccountBalance(
  prisma: PrismaClient,
  accountId: string
): Promise<Prisma.Decimal> {
  const result = await prisma.entry.aggregate({
    where: { accountId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? new Prisma.Decimal(0);
}
