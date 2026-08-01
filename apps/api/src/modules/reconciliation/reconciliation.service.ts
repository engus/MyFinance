import { PrismaClient, Prisma } from '@prisma/client';
import { createTransaction, getAccountBalance } from '../ledger/ledger.service';
import { SYSTEM_CATEGORY_OTHER } from '../categories/categories.service';

export async function computeReconciliationDelta(
  prisma: PrismaClient,
  accountId: string,
  newBalance: string
): Promise<Prisma.Decimal> {
  const currentBalance = await getAccountBalance(prisma, accountId);
  return new Prisma.Decimal(newBalance).minus(currentBalance);
}

export async function applyReconciliation(
  prisma: PrismaClient,
  params: { userId: string; accountId: string; newBalance: string; date: Date }
): Promise<{ delta: Prisma.Decimal; applied: boolean }> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: params.accountId } });
  const delta = await computeReconciliationDelta(prisma, params.accountId, params.newBalance);

  if (delta.equals(0)) {
    return { delta, applied: false };
  }

  const otherCategory = await prisma.category.findFirstOrThrow({
    where: { userId: params.userId, name: SYSTEM_CATEGORY_OTHER, isSystem: true },
  });

  await createTransaction(prisma, {
    userId: params.userId,
    description: 'Balance reconciliation',
    date: params.date,
    entries: [
      { accountId: account.id, amount: delta.toString(), currency: account.currency },
      { categoryId: otherCategory.id, amount: delta.negated().toString(), currency: account.currency },
    ],
  });

  return { delta, applied: true };
}
