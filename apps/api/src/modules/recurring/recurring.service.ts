import { RecurrenceInterval } from '@prisma/client';

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
