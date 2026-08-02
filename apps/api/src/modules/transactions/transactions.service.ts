import { PrismaClient, TransactionType } from '@prisma/client';
import { dateOnly } from '../../lib/date';

export interface TransactionFilters {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  type?: TransactionType;
  cursor?: string;
  limit?: number;
}

export async function listTransactions(
  prisma: PrismaClient,
  userId: string,
  filters: TransactionFilters
) {
  const limit = Math.min(filters.limit ?? 50, 100);
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      occurredOn: {
        ...(filters.from ? { gte: dateOnly(filters.from) } : {}),
        ...(filters.to ? { lte: dateOnly(filters.to) } : {}),
      },
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.accountId ? { entries: { some: { accountId: filters.accountId } } } : {}),
      ...(filters.categoryId ? { entries: { some: { categoryId: filters.categoryId } } } : {}),
    },
    include: {
      entries: {
        include: {
          account: { select: { name: true, class: true } },
          category: { select: { name: true, kind: true } },
        },
      },
      reversalOf: { select: { id: true } },
      reversedBy: { select: { id: true } },
      replacement: { select: { id: true } },
    },
    orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
}
