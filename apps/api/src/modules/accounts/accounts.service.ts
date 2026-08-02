import { PrismaClient } from '@prisma/client';
import { getAccountBalance } from '../ledger/ledger.service';

export class AccountNotFoundError extends Error {}

export async function createAccount(
  prisma: PrismaClient,
  params: { userId: string; name: string; kind: 'FINANCIAL' | 'ASSET'; currency: string }
) {
  return prisma.account.create({
    data: {
      userId: params.userId,
      name: params.name,
      kind: params.kind,
      currency: params.currency,
    },
  });
}

export async function listAccountsWithBalances(prisma: PrismaClient, userId: string) {
  const accounts = await prisma.account.findMany({ where: { userId, isActive: true } });
  const withBalances = await Promise.all(
    accounts.map(async (account) => ({
      ...account,
      balance: (await getAccountBalance(prisma, account.id)).toString(),
    }))
  );
  return withBalances;
}

export async function updateAccount(
  prisma: PrismaClient,
  params: { userId: string; accountId: string; name?: string; currency?: string }
) {
  const account = await prisma.account.findFirst({
    where: { id: params.accountId, userId: params.userId },
  });
  if (!account) throw new AccountNotFoundError();

  return prisma.account.update({
    where: { id: params.accountId },
    data: { name: params.name, currency: params.currency },
  });
}

export async function deleteAccount(
  prisma: PrismaClient,
  params: { userId: string; accountId: string }
): Promise<{ hardDeleted: boolean }> {
  const account = await prisma.account.findFirst({
    where: { id: params.accountId, userId: params.userId },
  });
  if (!account) throw new AccountNotFoundError();

  const entryCount = await prisma.entry.count({ where: { accountId: params.accountId } });
  if (entryCount === 0) {
    await prisma.account.delete({ where: { id: params.accountId } });
    return { hardDeleted: true };
  }

  await prisma.account.update({ where: { id: params.accountId }, data: { isActive: false } });
  return { hardDeleted: false };
}
