import { Prisma, PrismaClient } from '@prisma/client';
import { CreateLiabilityInput } from '@myfinance/contracts';
import { dateOnly } from '../../lib/date';
import { AppError } from '../../lib/errors';
import { postJournal } from '../ledger/ledger.service';
import { RateService } from '../rates/rates.service';

export async function listLiabilities(prisma: PrismaClient, userId: string) {
  const accounts = await prisma.account.findMany({
    where: { userId, class: 'LIABILITY', isArchived: false },
    include: {
      liabilityProfile: true,
      entries: {
        where: { transaction: { occurredOn: { lte: dateOnly(new Date()) } } },
        select: { originalAmount: true },
      },
    },
    orderBy: { name: 'asc' },
  });
  return accounts.map((account) => ({
    ...account,
    balance: account.entries
      .reduce((sum, entry) => sum.add(entry.originalAmount), new Prisma.Decimal(0))
      .toString(),
    entries: undefined,
  }));
}

export async function createLiability(
  prisma: PrismaClient,
  rates: RateService,
  userId: string,
  input: CreateLiabilityInput
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  const openingDate = dateOnly(input.openingDate);
  const rate = await rates.resolve(
    input.currency,
    user.functionalCurrency,
    openingDate,
    input.fxRate,
    userId
  );
  const originalAmount = new Prisma.Decimal(input.openingBalance).negated();
  const functionalAmount = originalAmount
    .mul(rate.rate)
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);
  return prisma.$transaction(async (tx) => {
    const equity = await tx.account.findFirst({
      where: { userId, isSystem: true, class: 'EQUITY' },
    });
    if (!equity)
      throw new AppError(500, 'SYSTEM_DATA_MISSING', 'Opening balance equity is missing');
    const account = await tx.account.create({
      data: {
        userId,
        name: input.name,
        class: 'LIABILITY',
        subtype: input.subtype,
        currency: input.currency,
        liabilityProfile: {
          create: {
            creditor: input.creditor,
            annualInterestRate: input.annualInterestRate,
            maturityDate: input.maturityDate ? dateOnly(input.maturityDate) : undefined,
            notes: input.notes,
          },
        },
      },
      include: { liabilityProfile: true },
    });
    await postJournal(tx, {
      userId,
      type: 'OPENING_BALANCE',
      description: `Opening balance: ${input.name}`,
      occurredOn: openingDate,
      lines: [
        {
          accountId: account.id,
          originalAmount,
          originalCurrency: account.currency,
          functionalAmount,
          functionalCurrency: user.functionalCurrency,
          fxRate: rate.rate,
          rateSource: rate.source,
          rateDate: rate.date,
        },
        {
          accountId: equity.id,
          originalAmount: functionalAmount.negated(),
          originalCurrency: user.functionalCurrency,
          functionalAmount: functionalAmount.negated(),
          functionalCurrency: user.functionalCurrency,
          fxRate: new Prisma.Decimal(1),
          rateSource: 'MANUAL',
          rateDate: openingDate,
        },
      ],
    });
    return account;
  });
}

export async function updateLiability(
  prisma: PrismaClient,
  userId: string,
  accountId: string,
  input: {
    name?: string;
    creditor?: string;
    annualInterestRate?: string;
    maturityDate?: string;
    notes?: string;
    isArchived?: boolean;
  }
) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId, class: 'LIABILITY' },
  });
  if (!account) throw new AppError(404, 'LIABILITY_NOT_FOUND', 'Liability not found');
  return prisma.$transaction(async (tx) => {
    await tx.account.update({
      where: { id: accountId },
      data: { name: input.name, isArchived: input.isArchived },
    });
    if (input.isArchived) {
      await tx.recurringTemplate.updateMany({
        where: { userId, lines: { some: { accountId } }, status: 'ACTIVE' },
        data: { status: 'PAUSED' },
      });
    }
    return tx.liabilityProfile.update({
      where: { accountId },
      data: {
        creditor: input.creditor,
        annualInterestRate: input.annualInterestRate,
        maturityDate: input.maturityDate ? dateOnly(input.maturityDate) : undefined,
        notes: input.notes,
      },
    });
  });
}
