import { Prisma, PrismaClient } from '@prisma/client';
import { CreateAccountInput, UpdateAccountInput } from '@myfinance/contracts';
import { dateOnly } from '../../lib/date';
import { AppError } from '../../lib/errors';
import { postJournal } from '../ledger/ledger.service';
import { RateService } from '../rates/rates.service';

export async function listAccountsWithBalances(
  prisma: PrismaClient,
  userId: string,
  includeArchived = false
) {
  const [accounts, balances] = await Promise.all([
    prisma.account.findMany({
      where: { userId, isSystem: false, ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: [{ class: 'asc' }, { name: 'asc' }],
      include: { assetProfile: true, liabilityProfile: true },
    }),
    prisma.entry.groupBy({
      by: ['accountId'],
      where: {
        account: { userId, isSystem: false },
        accountId: { not: null },
        transaction: { occurredOn: { lte: dateOnly(new Date()) } },
      },
      _sum: { originalAmount: true },
    }),
  ]);
  const balanceMap = new Map(
    balances.flatMap((row) =>
      row.accountId ? [[row.accountId, row._sum.originalAmount?.toString() ?? '0']] : []
    )
  );
  return accounts.map((account) => ({ ...account, balance: balanceMap.get(account.id) ?? '0' }));
}

function validateSubtype(
  accountClass: 'ASSET' | 'LIABILITY',
  subtype: CreateAccountInput['subtype']
) {
  const liabilitySubtypes = new Set(['MORTGAGE', 'LOAN', 'CREDIT_CARD']);
  if (accountClass === 'LIABILITY' && !liabilitySubtypes.has(subtype)) {
    throw new AppError(400, 'INVALID_ACCOUNT_SUBTYPE', 'Choose a liability subtype');
  }
  if (accountClass === 'ASSET' && liabilitySubtypes.has(subtype)) {
    throw new AppError(400, 'INVALID_ACCOUNT_SUBTYPE', 'Choose an asset subtype');
  }
}

export async function createAccount(
  prisma: PrismaClient,
  rates: RateService,
  userId: string,
  input: CreateAccountInput
) {
  validateSubtype(input.class, input.subtype);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  const openingDate = dateOnly(input.openingDate ?? new Date());
  const rate = input.openingBalance
    ? await rates.resolve(
        input.currency,
        user.functionalCurrency,
        openingDate,
        input.openingFxRate,
        userId
      )
    : undefined;

  return prisma.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: {
        userId,
        name: input.name,
        class: input.class,
        subtype: input.subtype,
        currency: input.currency,
        institution: input.institution,
        countryCode: input.countryCode,
        region: input.region,
      },
    });
    if (!input.openingBalance || new Prisma.Decimal(input.openingBalance).equals(0)) return account;
    const equity = await tx.account.findFirst({
      where: { userId, isSystem: true, class: 'EQUITY' },
    });
    if (!equity || !rate)
      throw new AppError(500, 'SYSTEM_DATA_MISSING', 'Opening balance equity is missing');
    const magnitude = new Prisma.Decimal(input.openingBalance);
    const originalAmount = input.class === 'LIABILITY' ? magnitude.negated() : magnitude;
    const functionalAmount = originalAmount
      .mul(rate.rate)
      .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);
    await postJournal(tx, {
      userId,
      type: 'OPENING_BALANCE',
      description: `Opening balance: ${account.name}`,
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

export async function updateAccount(
  prisma: PrismaClient,
  userId: string,
  accountId: string,
  input: UpdateAccountInput
) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId, isSystem: false },
  });
  if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
  if (input.currency && input.currency !== account.currency) {
    const used = await prisma.entry.count({ where: { accountId } });
    if (used > 0) {
      throw new AppError(
        409,
        'ACCOUNT_CURRENCY_LOCKED',
        'Currency cannot change after the first posting'
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.account.update({ where: { id: accountId }, data: input });
    if (input.isArchived) {
      await tx.recurringTemplate.updateMany({
        where: { userId, lines: { some: { accountId } }, status: 'ACTIVE' },
        data: { status: 'PAUSED' },
      });
    }
    return updated;
  });
}
