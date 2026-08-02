import { Prisma, PrismaClient, RecurrenceInterval } from '@prisma/client';
import { createOperationSchema, RecurrenceInput } from '@myfinance/contracts';
import { dateOnly, formatDateOnly } from '../../lib/date';
import { AppError } from '../../lib/errors';
import { postJournal, prepareOperation } from '../ledger/ledger.service';
import { RateService } from '../rates/rates.service';

function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const daysInMonth = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
  ).getUTCDate();
  next.setUTCDate(Math.min(day, daysInMonth));
  return next;
}

export function advance(date: Date, interval: RecurrenceInterval, customDays?: number): Date {
  const next = new Date(date);
  if (interval === 'WEEK') next.setUTCDate(next.getUTCDate() + 7);
  else if (interval === 'MONTH') return addMonths(date, 1);
  else if (interval === 'QUARTER') return addMonths(date, 3);
  else if (interval === 'YEAR') return addMonths(date, 12);
  else if (interval === 'CUSTOM' && customDays) next.setUTCDate(next.getUTCDate() + customDays);
  else
    throw new AppError(400, 'INVALID_RECURRENCE', 'customDays is required for a custom interval');
  return next;
}

export async function createRecurringTemplate(
  prisma: PrismaClient,
  rates: RateService,
  userId: string,
  input: RecurrenceInput
) {
  const operation = { ...input.operation, date: input.startDate };
  const prepared = await prepareOperation(prisma, rates, userId, operation);
  return prisma.recurringTemplate.create({
    data: {
      userId,
      type: prepared.type,
      description: prepared.description,
      payload: operation as Prisma.InputJsonValue,
      interval: input.interval,
      customDays: input.interval === 'CUSTOM' ? input.customDays : null,
      nextRunDate: dateOnly(input.startDate),
      lines: {
        create: prepared.lines.map((line) => ({
          accountId: line.accountId,
          categoryId: line.categoryId,
          originalAmount: line.originalAmount,
          currency: line.originalCurrency,
        })),
      },
    },
    include: { lines: true },
  });
}

export async function listRecurringTemplates(prisma: PrismaClient, userId: string) {
  return prisma.recurringTemplate.findMany({
    where: { userId, status: { not: 'ARCHIVED' } },
    include: { lines: true },
    orderBy: { nextRunDate: 'asc' },
  });
}

export async function updateRecurringTemplate(
  prisma: PrismaClient,
  userId: string,
  id: string,
  input: { status?: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'; nextRunDate?: string }
) {
  const template = await prisma.recurringTemplate.findFirst({ where: { id, userId } });
  if (!template) throw new AppError(404, 'RECURRING_NOT_FOUND', 'Recurring template not found');
  return prisma.recurringTemplate.update({
    where: { id },
    data: {
      status: input.status,
      nextRunDate: input.nextRunDate ? dateOnly(input.nextRunDate) : undefined,
    },
  });
}

export async function generateDueOccurrences(
  prisma: PrismaClient,
  rates: RateService,
  userId: string,
  options: { accountId?: string; through?: Date; limit?: number } = {}
) {
  const through = dateOnly(options.through ?? new Date());
  const limit = Math.min(options.limit ?? 120, 240);
  const templates = await prisma.recurringTemplate.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      nextRunDate: { lte: through },
      ...(options.accountId ? { lines: { some: { accountId: options.accountId } } } : {}),
    },
    orderBy: { nextRunDate: 'asc' },
    take: limit,
  });
  const generated: string[] = [];

  for (const initial of templates) {
    let scheduledDate = initial.nextRunDate;
    while (scheduledDate <= through && generated.length < limit) {
      const nextRunDate = advance(scheduledDate, initial.interval, initial.customDays ?? undefined);
      const parsed = createOperationSchema.parse({
        ...(initial.payload as Record<string, unknown>),
        date: formatDateOnly(scheduledDate),
      });
      const prepared = await prepareOperation(prisma, rates, userId, parsed);
      try {
        const transactionId = await prisma.$transaction(
          async (tx) => {
            const claimed = await tx.recurringTemplate.updateMany({
              where: { id: initial.id, userId, status: 'ACTIVE', nextRunDate: scheduledDate },
              data: { nextRunDate },
            });
            if (claimed.count !== 1)
              throw new AppError(409, 'RECURRENCE_CLAIMED', 'Occurrence was claimed');
            const transaction = await postJournal(tx, {
              userId,
              type: prepared.type,
              description: prepared.description,
              occurredOn: scheduledDate,
              lines: prepared.lines,
              metadata: {
                recurringTemplateId: initial.id,
                scheduledDate: formatDateOnly(scheduledDate),
              },
            });
            await tx.recurringOccurrence.create({
              data: { templateId: initial.id, scheduledDate, transactionId: transaction.id },
            });
            return transaction.id;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        generated.push(transactionId);
      } catch (error) {
        if (
          (error instanceof AppError && error.code === 'RECURRENCE_CLAIMED') ||
          (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
          (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        ) {
          break;
        }
        throw error;
      }
      scheduledDate = nextRunDate;
    }
  }

  return { transactionIds: generated, truncated: generated.length >= limit };
}
