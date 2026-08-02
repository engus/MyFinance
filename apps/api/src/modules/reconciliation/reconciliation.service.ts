import { Prisma, PrismaClient } from '@prisma/client';
import { dateOnly } from '../../lib/date';
import { AppError } from '../../lib/errors';
import { getAccountBalance, postJournal } from '../ledger/ledger.service';
import { RateService } from '../rates/rates.service';
import { generateDueOccurrences } from '../recurring/recurring.service';

const PREVIEW_TTL_MS = 15 * 60 * 1000;

export async function previewReconciliation(
  prisma: PrismaClient,
  rates: RateService,
  userId: string,
  input: { accountId: string; statedBalance: string; date: string; fxRate?: string }
) {
  const account = await prisma.account.findFirst({
    where: { id: input.accountId, userId, isArchived: false },
    include: { user: true },
  });
  if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
  const reconciliationDate = dateOnly(input.date);
  const generated = await generateDueOccurrences(prisma, rates, userId, {
    accountId: account.id,
    through: reconciliationDate,
  });
  const refreshed = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
  const expectedBalance = await getAccountBalance(prisma, account.id, reconciliationDate);
  const statedBalance = new Prisma.Decimal(input.statedBalance);
  const delta = statedBalance.sub(expectedBalance);
  const preview = await prisma.reconciliation.create({
    data: {
      userId,
      accountId: account.id,
      reconciliationDate,
      statedBalance,
      expectedBalance,
      delta,
      currency: account.currency,
      expectedVersion: refreshed.version,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
    },
  });
  if (account.user.reconciliationMode === 'AUTO') {
    const applied = await confirmReconciliation(prisma, rates, userId, preview.id, input.fxRate);
    return {
      ...applied,
      generatedOccurrences: generated.transactionIds,
      requiresConfirmation: false,
    };
  }
  return {
    ...preview,
    expectedBalance: expectedBalance.toString(),
    statedBalance: statedBalance.toString(),
    delta: delta.toString(),
    generatedOccurrences: generated.transactionIds,
    requiresConfirmation: true,
  };
}

export async function confirmReconciliation(
  prisma: PrismaClient,
  rates: RateService,
  userId: string,
  reconciliationId: string,
  manualRate?: string
) {
  const preview = await prisma.reconciliation.findFirst({
    where: { id: reconciliationId, userId, status: 'PENDING' },
    include: { account: true, user: true },
  });
  if (!preview)
    throw new AppError(404, 'RECONCILIATION_NOT_FOUND', 'Reconciliation preview not found');
  if (preview.expiresAt <= new Date())
    throw new AppError(409, 'PREVIEW_EXPIRED', 'Reconciliation preview expired');
  const rate = preview.delta.equals(0)
    ? undefined
    : await rates.resolve(
        preview.currency,
        preview.user.functionalCurrency,
        preview.reconciliationDate,
        manualRate,
        userId
      );

  const apply = async () =>
    prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${preview.accountId} FOR UPDATE`;
        const account = await tx.account.findUniqueOrThrow({ where: { id: preview.accountId } });
        const currentBalance = await getAccountBalance(tx, account.id, preview.reconciliationDate);
        if (
          account.version !== preview.expectedVersion ||
          !currentBalance.equals(preview.expectedBalance)
        ) {
          throw new AppError(409, 'RECONCILIATION_STALE', 'Account changed; create a new preview');
        }
        if (preview.delta.equals(0)) {
          const applied = await tx.reconciliation.update({
            where: { id: preview.id },
            data: { status: 'APPLIED', appliedAt: new Date() },
          });
          return { ...applied, delta: '0', applied: false };
        }
        const systemKey = preview.delta.isPositive() ? 'OTHER_INCOME' : 'OTHER_EXPENSE';
        const category = await tx.category.findFirst({ where: { userId, systemKey } });
        if (!category || !rate)
          throw new AppError(500, 'SYSTEM_DATA_MISSING', 'Reconciliation category is missing');
        const functionalDelta = preview.delta
          .mul(rate.rate)
          .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);
        const transaction = await postJournal(tx, {
          userId,
          type: preview.delta.isPositive() ? 'INCOME' : 'EXPENSE',
          description: 'Balance reconciliation',
          occurredOn: preview.reconciliationDate,
          lines: [
            {
              accountId: account.id,
              originalAmount: preview.delta,
              originalCurrency: account.currency,
              functionalAmount: functionalDelta,
              functionalCurrency: preview.user.functionalCurrency,
              fxRate: rate.rate,
              rateSource: rate.source,
              rateDate: rate.date,
            },
            {
              categoryId: category.id,
              originalAmount: preview.delta.negated(),
              originalCurrency: account.currency,
              functionalAmount: functionalDelta.negated(),
              functionalCurrency: preview.user.functionalCurrency,
              fxRate: rate.rate,
              rateSource: rate.source,
              rateDate: rate.date,
            },
          ],
        });
        const applied = await tx.reconciliation.update({
          where: { id: preview.id },
          data: { status: 'APPLIED', appliedAt: new Date(), transactionId: transaction.id },
        });
        return { ...applied, delta: preview.delta.toString(), applied: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await apply();
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new AppError(503, 'RECONCILIATION_RETRY_EXHAUSTED', 'Please retry reconciliation');
}
