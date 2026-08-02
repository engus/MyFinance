import { RecurrenceInterval, PrismaClient, Transaction } from '@prisma/client';
import { createTransaction } from '../ledger/ledger.service';

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
  switch (interval) {
    case 'WEEK': {
      const next = new Date(date);
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    }
    case 'MONTH':
      return addMonths(date, 1);
    case 'QUARTER':
      return addMonths(date, 3);
    case 'YEAR': {
      const day = date.getUTCDate();
      const next = new Date(date);
      next.setUTCDate(1);
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      const daysInMonth = new Date(
        Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
      ).getUTCDate();
      next.setUTCDate(Math.min(day, daysInMonth));
      return next;
    }
    case 'CUSTOM': {
      if (!customDays) {
        throw new Error('customDays is required for CUSTOM interval');
      }
      const next = new Date(date);
      next.setUTCDate(next.getUTCDate() + customDays);
      return next;
    }
    default:
      throw new Error(`Unknown interval: ${interval}`);
  }
}

export async function generateDueOccurrences(
  prisma: PrismaClient,
  userId: string
): Promise<Transaction[]> {
  const now = new Date();
  const templates = await prisma.transaction.findMany({
    where: {
      userId,
      frequency: 'RECURRING',
      isActive: true,
      nextRunDate: { lte: now },
    },
  });

  const generated: Transaction[] = [];

  for (const template of templates) {
    let nextRunDate = template.nextRunDate!;
    const accountAmount = template.templateAmount!;
    const categoryAmount = accountAmount.negated();

    while (nextRunDate <= now) {
      const occurrence = await createTransaction(prisma, {
        userId,
        description: template.description,
        date: nextRunDate,
        frequency: 'ONE_OFF',
        templateId: template.id,
        entries: [
          {
            accountId: template.templateAccountId!,
            amount: accountAmount.toString(),
            currency: template.templateCurrency!,
          },
          {
            categoryId: template.templateCategoryId!,
            amount: categoryAmount.toString(),
            currency: template.templateCurrency!,
          },
        ],
      });
      generated.push(occurrence);

      nextRunDate = advance(nextRunDate, template.interval!, template.customDays ?? undefined);
      await prisma.transaction.update({
        where: { id: template.id },
        data: { nextRunDate },
      });
    }
  }

  return generated;
}
