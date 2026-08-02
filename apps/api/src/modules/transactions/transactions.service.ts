import { PrismaClient, Prisma, RecurrenceInterval, Transaction } from '@prisma/client';
import {
  EntryInput,
  assertEntriesTargetExactlyOne,
  assertEntriesBalance,
  assertEntriesReferenceOwnedResources,
} from '../ledger/ledger.service';

export class TransactionNotFoundError extends Error {}
export class NotARecurringTemplateError extends Error {}
export class NotAOneOffTransactionError extends Error {}

export interface CreateRecurringTemplateInput {
  userId: string;
  description: string;
  accountId: string;
  categoryId: string;
  amount: string;
  currency: string;
  interval: RecurrenceInterval;
  customDays?: number;
  startDate: Date;
}

export async function createRecurringTemplate(
  prisma: PrismaClient,
  input: CreateRecurringTemplateInput
): Promise<Transaction> {
  await assertEntriesReferenceOwnedResources(prisma, input.userId, [
    { accountId: input.accountId, amount: input.amount, currency: input.currency },
    { categoryId: input.categoryId, amount: input.amount, currency: input.currency },
  ]);

  return prisma.transaction.create({
    data: {
      userId: input.userId,
      description: input.description,
      date: input.startDate,
      frequency: 'RECURRING',
      interval: input.interval,
      customDays: input.customDays,
      nextRunDate: input.startDate,
      templateAccountId: input.accountId,
      templateCategoryId: input.categoryId,
      templateAmount: input.amount,
      templateCurrency: input.currency,
    },
    include: { entries: true },
  });
}

export interface ListTransactionsFilters {
  kind?: 'INCOME' | 'EXPENSE';
  frequency?: 'ONE_OFF' | 'RECURRING';
  accountId?: string;
}

export async function listTransactions(
  prisma: PrismaClient,
  userId: string,
  filters: ListTransactionsFilters = {}
): Promise<Transaction[]> {
  const conditions: Prisma.TransactionWhereInput[] = [{ userId }, { isActive: true }];

  if (filters.frequency) {
    conditions.push({ frequency: filters.frequency });
  }
  if (filters.accountId) {
    conditions.push({
      OR: [
        { entries: { some: { accountId: filters.accountId } } },
        { templateAccountId: filters.accountId },
      ],
    });
  }
  if (filters.kind) {
    conditions.push({
      OR: [
        { entries: { some: { category: { kind: filters.kind } } } },
        { templateCategory: { kind: filters.kind } },
      ],
    });
  }

  return prisma.transaction.findMany({
    where: { AND: conditions },
    include: { entries: true, templateAccount: true, templateCategory: true },
    orderBy: { date: 'desc' },
  });
}

export async function updateRecurringTemplate(
  prisma: PrismaClient,
  params: {
    userId: string;
    transactionId: string;
    amount?: string;
    interval?: RecurrenceInterval;
    customDays?: number;
    isActive?: boolean;
  }
): Promise<Transaction> {
  const template = await prisma.transaction.findFirst({
    where: { id: params.transactionId, userId: params.userId },
  });
  if (!template) throw new TransactionNotFoundError();
  if (template.frequency !== 'RECURRING') throw new NotARecurringTemplateError();

  return prisma.transaction.update({
    where: { id: params.transactionId },
    data: {
      templateAmount: params.amount,
      interval: params.interval,
      customDays: params.customDays,
      isActive: params.isActive,
    },
  });
}

export async function updateOneOffTransaction(
  prisma: PrismaClient,
  params: {
    userId: string;
    transactionId: string;
    description?: string;
    date?: Date;
    entries: [EntryInput, EntryInput];
  }
): Promise<Transaction> {
  const transaction = await prisma.transaction.findFirst({
    where: { id: params.transactionId, userId: params.userId },
  });
  if (!transaction) throw new TransactionNotFoundError();
  if (transaction.frequency !== 'ONE_OFF') throw new NotAOneOffTransactionError();

  assertEntriesTargetExactlyOne(params.entries);
  await assertEntriesReferenceOwnedResources(prisma, params.userId, params.entries);
  assertEntriesBalance(params.entries);

  await prisma.entry.deleteMany({ where: { transactionId: transaction.id } });
  return prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      description: params.description ?? transaction.description,
      date: params.date ?? transaction.date,
      entries: {
        create: params.entries.map((e) => ({
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

export async function deleteTransaction(
  prisma: PrismaClient,
  params: { userId: string; transactionId: string }
): Promise<{ hardDeleted: boolean }> {
  const transaction = await prisma.transaction.findFirst({
    where: { id: params.transactionId, userId: params.userId },
  });
  if (!transaction) throw new TransactionNotFoundError();

  if (transaction.frequency === 'RECURRING') {
    await prisma.transaction.update({ where: { id: transaction.id }, data: { isActive: false } });
    return { hardDeleted: false };
  }

  await prisma.transaction.delete({ where: { id: transaction.id } });
  return { hardDeleted: true };
}
