import { Prisma, PrismaClient } from '@prisma/client';
import { CreateAssetInput, CreateValuationInput } from '@myfinance/contracts';
import { dateOnly } from '../../lib/date';
import { AppError } from '../../lib/errors';
import { postJournal } from '../ledger/ledger.service';
import { RateService } from '../rates/rates.service';

const SUBTYPE_BY_ASSET = {
  REAL_ESTATE: 'REAL_ESTATE',
  VEHICLE: 'VEHICLE',
  SECURITY: 'SECURITY',
  PRIVATE_BUSINESS: 'PRIVATE_BUSINESS',
  COLLECTIBLE: 'COLLECTIBLE',
  OTHER: 'OTHER',
} as const;

export async function listAssets(prisma: PrismaClient, userId: string) {
  const assets = await prisma.assetProfile.findMany({
    where: { userId, account: { isArchived: false } },
    include: {
      account: true,
      valuations: {
        where: { valuationDate: { lte: dateOnly(new Date()) } },
        orderBy: [{ valuationDate: 'desc' }, { source: 'asc' }],
        take: 20,
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return assets.map((asset) => ({ ...asset, currentValuation: asset.valuations[0] ?? null }));
}

export async function updateAsset(
  prisma: PrismaClient,
  userId: string,
  assetId: string,
  input: {
    name?: string;
    countryCode?: string;
    region?: string;
    institution?: string;
    ownershipShare?: string;
    notes?: string;
    isArchived?: boolean;
  }
) {
  const asset = await prisma.assetProfile.findFirst({ where: { id: assetId, userId } });
  if (!asset) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  return prisma.$transaction(async (tx) => {
    if (input.name !== undefined || input.isArchived !== undefined) {
      await tx.account.update({
        where: { id: asset.accountId },
        data: { name: input.name, isArchived: input.isArchived },
      });
    }
    if (input.isArchived) {
      await tx.recurringTemplate.updateMany({
        where: { userId, lines: { some: { accountId: asset.accountId } }, status: 'ACTIVE' },
        data: { status: 'PAUSED' },
      });
    }
    return tx.assetProfile.update({
      where: { id: assetId },
      data: {
        countryCode: input.countryCode,
        region: input.region,
        institution: input.institution,
        ownershipShare: input.ownershipShare,
        notes: input.notes,
      },
      include: { account: true },
    });
  });
}

export async function createAsset(
  prisma: PrismaClient,
  rates: RateService,
  userId: string,
  input: CreateAssetInput
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  const valuationDate = dateOnly(input.valuationDate);
  const rate = await rates.resolve(
    input.currency,
    user.functionalCurrency,
    valuationDate,
    input.fxRate,
    userId
  );
  const amount = new Prisma.Decimal(input.initialValue)
    .mul(new Prisma.Decimal(input.ownershipShare).div(100))
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);
  const functionalAmount = amount.mul(rate.rate).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);

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
        class: 'ASSET',
        subtype: SUBTYPE_BY_ASSET[input.type],
        currency: input.currency,
        institution: input.institution,
        countryCode: input.countryCode,
        region: input.region,
      },
    });
    const asset = await tx.assetProfile.create({
      data: {
        userId,
        accountId: account.id,
        type: input.type,
        countryCode: input.countryCode,
        region: input.region,
        institution: input.institution,
        ownershipShare: input.ownershipShare,
        notes: input.notes,
      },
    });
    const transaction = await postJournal(tx, {
      userId,
      type: 'OPENING_BALANCE',
      description: `Opening valuation: ${input.name}`,
      occurredOn: valuationDate,
      lines: [
        {
          accountId: account.id,
          originalAmount: amount,
          originalCurrency: input.currency,
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
          rateDate: valuationDate,
        },
      ],
    });
    await tx.assetValuation.create({
      data: {
        assetId: asset.id,
        valuationDate,
        amount,
        currency: input.currency,
        source: 'MANUAL',
        transactionId: transaction.id,
      },
    });
    return tx.assetProfile.findUniqueOrThrow({
      where: { id: asset.id },
      include: { account: true, valuations: true },
    });
  });
}

export async function recordValuation(
  prisma: PrismaClient,
  rates: RateService,
  userId: string,
  assetId: string,
  input: CreateValuationInput
) {
  const asset = await prisma.assetProfile.findFirst({
    where: { id: assetId, userId, account: { isArchived: false } },
    include: {
      account: true,
      user: true,
      valuations: { orderBy: [{ valuationDate: 'desc' }, { source: 'asc' }], take: 1 },
    },
  });
  if (!asset) throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  if (asset.account.currency !== input.currency) {
    throw new AppError(400, 'CURRENCY_MISMATCH', 'Valuation currency must match the asset account');
  }
  const valuationDate = dateOnly(input.date);
  if (input.source === 'MARKET') {
    const manualForDate = await prisma.assetValuation.findUnique({
      where: { assetId_valuationDate_source: { assetId, valuationDate, source: 'MANUAL' } },
    });
    if (manualForDate) return manualForDate;
  }
  const existing = await prisma.assetValuation.findUnique({
    where: { assetId_valuationDate_source: { assetId, valuationDate, source: input.source } },
  });
  if (existing) return existing;
  if (asset.valuations[0] && asset.valuations[0].valuationDate > valuationDate) {
    throw new AppError(
      409,
      'VALUATION_DATE_ORDER',
      'New valuations cannot predate the latest valuation'
    );
  }
  const amount = new Prisma.Decimal(input.amount)
    .mul(asset.ownershipShare.div(100))
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);
  const current = asset.valuations[0]?.amount ?? new Prisma.Decimal(0);
  const delta = amount.sub(current);
  if (delta.equals(0)) throw new AppError(409, 'VALUATION_UNCHANGED', 'Valuation has not changed');
  const rate = await rates.resolve(
    input.currency,
    asset.user.functionalCurrency,
    valuationDate,
    input.fxRate,
    userId
  );
  const functionalDelta = delta.mul(rate.rate).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);

  try {
    return await prisma.$transaction(
      async (tx) => {
        const category = await tx.category.findFirst({
          where: { userId, systemKey: delta.isPositive() ? 'UNREALIZED_GAIN' : 'UNREALIZED_LOSS' },
        });
        if (!category)
          throw new AppError(500, 'SYSTEM_DATA_MISSING', 'Valuation category is missing');
        const transaction = await postJournal(tx, {
          userId,
          type: 'VALUATION',
          description: `Valuation: ${asset.account.name}`,
          occurredOn: valuationDate,
          lines: [
            {
              accountId: asset.account.id,
              originalAmount: delta,
              originalCurrency: asset.account.currency,
              functionalAmount: functionalDelta,
              functionalCurrency: asset.user.functionalCurrency,
              fxRate: rate.rate,
              rateSource: rate.source,
              rateDate: rate.date,
            },
            {
              categoryId: category.id,
              originalAmount: delta.negated(),
              originalCurrency: asset.account.currency,
              functionalAmount: functionalDelta.negated(),
              functionalCurrency: asset.user.functionalCurrency,
              fxRate: rate.rate,
              rateSource: rate.source,
              rateDate: rate.date,
            },
          ],
        });
        return tx.assetValuation.create({
          data: {
            assetId,
            valuationDate,
            amount,
            currency: input.currency,
            source: input.source,
            transactionId: transaction.id,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' || error.code === 'P2034')
    ) {
      const committed = await prisma.assetValuation.findUnique({
        where: { assetId_valuationDate_source: { assetId, valuationDate, source: input.source } },
      });
      if (committed) return committed;
    }
    throw error;
  }
}
