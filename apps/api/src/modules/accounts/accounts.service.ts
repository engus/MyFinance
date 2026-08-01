import { PrismaClient } from '@prisma/client';
import { getAccountBalance } from '../ledger/ledger.service';

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
  const accounts = await prisma.account.findMany({ where: { userId } });
  const withBalances = await Promise.all(
    accounts.map(async (account) => ({
      ...account,
      balance: (await getAccountBalance(prisma, account.id)).toString(),
    }))
  );
  return withBalances;
}
