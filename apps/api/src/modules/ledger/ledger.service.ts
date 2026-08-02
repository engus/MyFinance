import { PrismaClient, Prisma } from '@prisma/client';

export type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

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
  templateId?: string;
}

export class UnbalancedTransactionError extends Error {}
export class InvalidEntryError extends Error {}

export function assertEntriesTargetExactlyOne(entries: EntryInput[]): void {
  for (const entry of entries) {
    const hasAccount = Boolean(entry.accountId);
    const hasCategory = Boolean(entry.categoryId);
    if (hasAccount === hasCategory) {
      throw new InvalidEntryError('Entry must reference exactly one of accountId or categoryId');
    }
  }
}

export function assertEntriesBalance(entries: EntryInput[]): void {
  const sum = entries.reduce(
    (acc, e) => acc.plus(new Prisma.Decimal(e.amount)),
    new Prisma.Decimal(0)
  );
  if (!sum.equals(0)) {
    throw new UnbalancedTransactionError(`Entries must sum to zero, got ${sum.toString()}`);
  }
}

/**
 * Validates that every accountId/categoryId referenced by `entries` exists and
 * belongs to `userId`, and that account-referencing entries' currencies match
 * their account's currency. This is the shared choke point for all entry
 * creation, so every write path (one-off transactions, recurring templates,
 * recurring occurrence generation, reconciliation) is protected from
 * referencing another user's resources.
 */
export async function assertEntriesReferenceOwnedResources(
  prisma: PrismaClientOrTx,
  userId: string,
  entries: EntryInput[]
): Promise<void> {
  const accountIds = entries.map((e) => e.accountId).filter((id): id is string => Boolean(id));
  const categoryIds = entries.map((e) => e.categoryId).filter((id): id is string => Boolean(id));

  if (accountIds.length > 0) {
    const accounts = await prisma.account.findMany({ where: { id: { in: accountIds }, userId } });
    const accountsById = new Map(accounts.map((a) => [a.id, a]));

    for (const entry of entries) {
      if (!entry.accountId) continue;
      const account = accountsById.get(entry.accountId);
      if (!account) {
        throw new InvalidEntryError(`Account ${entry.accountId} not found`);
      }
      if (account.currency !== entry.currency) {
        throw new InvalidEntryError(
          `Entry currency ${entry.currency} does not match account currency ${account.currency}`
        );
      }
    }
  }

  if (categoryIds.length > 0) {
    const categories = await prisma.category.findMany({ where: { id: { in: categoryIds }, userId } });
    const ownedCategoryIds = new Set(categories.map((c) => c.id));

    for (const entry of entries) {
      if (!entry.categoryId) continue;
      if (!ownedCategoryIds.has(entry.categoryId)) {
        throw new InvalidEntryError(`Category ${entry.categoryId} not found`);
      }
    }
  }
}

export async function createTransaction(prisma: PrismaClientOrTx, input: CreateTransactionInput) {
  assertEntriesTargetExactlyOne(input.entries);
  await assertEntriesReferenceOwnedResources(prisma, input.userId, input.entries);
  assertEntriesBalance(input.entries);

  return prisma.transaction.create({
    data: {
      userId: input.userId,
      description: input.description,
      date: input.date,
      frequency: input.frequency ?? 'ONE_OFF',
      interval: input.interval,
      customDays: input.customDays,
      templateId: input.templateId,
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
