import { Prisma, PrismaClient, RateSource, TransactionType } from '@prisma/client';
import { CreateOperationInput } from '@myfinance/contracts';
import { dateOnly } from '../../lib/date';
import { AppError } from '../../lib/errors';
import { RateService, ResolvedRate } from '../rates/rates.service';

export type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export interface JournalLineInput {
  accountId?: string;
  categoryId?: string;
  originalAmount: Prisma.Decimal;
  originalCurrency: string;
  functionalAmount: Prisma.Decimal;
  functionalCurrency: string;
  fxRate: Prisma.Decimal;
  rateSource: RateSource;
  rateDate: Date;
}

interface PostJournalInput {
  userId: string;
  type: TransactionType;
  description: string;
  occurredOn: Date;
  lines: JournalLineInput[];
  metadata?: Prisma.InputJsonValue;
  reversalOfId?: string;
  replacementForId?: string;
  allowArchived?: boolean;
}

const ZERO = new Prisma.Decimal(0);

function rounded(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_EVEN);
}

function functional(amount: Prisma.Decimal, rate: Prisma.Decimal): Prisma.Decimal {
  return rounded(amount.mul(rate));
}

export async function assertJournalLines(
  prisma: PrismaClientOrTx,
  input: PostJournalInput
): Promise<void> {
  if (input.lines.length < 2)
    throw new AppError(400, 'INVALID_JOURNAL', 'At least two lines are required');
  const accountIds = input.lines.flatMap((line) => (line.accountId ? [line.accountId] : []));
  const categoryIds = input.lines.flatMap((line) => (line.categoryId ? [line.categoryId] : []));

  for (const line of input.lines) {
    if (Boolean(line.accountId) === Boolean(line.categoryId)) {
      throw new AppError(400, 'INVALID_JOURNAL', 'Each line must target one account or category');
    }
    if (line.functionalCurrency !== input.lines[0]?.functionalCurrency) {
      throw new AppError(400, 'INVALID_JOURNAL', 'All lines must share the functional currency');
    }
  }

  const [accounts, categories] = await Promise.all([
    prisma.account.findMany({ where: { id: { in: accountIds }, userId: input.userId } }),
    prisma.category.findMany({ where: { id: { in: categoryIds }, userId: input.userId } }),
  ]);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const categoryMap = new Map(categories.map((category) => [category.id, category]));

  for (const line of input.lines) {
    if (line.accountId) {
      const account = accountMap.get(line.accountId);
      if (!account || (!input.allowArchived && account.isArchived)) {
        throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
      }
      if (account.currency !== line.originalCurrency) {
        throw new AppError(400, 'CURRENCY_MISMATCH', 'Line currency does not match the account');
      }
    }
    if (line.categoryId) {
      const category = categoryMap.get(line.categoryId);
      if (!category || (!input.allowArchived && category.isArchived)) {
        throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
      }
    }
  }

  const total = input.lines.reduce((sum, line) => sum.add(line.functionalAmount), ZERO);
  if (!total.equals(0)) {
    throw new AppError(
      400,
      'UNBALANCED_JOURNAL',
      `Functional amounts must sum to zero; got ${total}`
    );
  }
}

export async function postJournal(prisma: PrismaClientOrTx, input: PostJournalInput) {
  await assertJournalLines(prisma, input);
  const transaction = await prisma.transaction.create({
    data: {
      userId: input.userId,
      type: input.type,
      description: input.description,
      occurredOn: input.occurredOn,
      metadata: input.metadata,
      reversalOfId: input.reversalOfId,
      replacementForId: input.replacementForId,
      entries: {
        create: input.lines.map((line) => ({
          accountId: line.accountId,
          categoryId: line.categoryId,
          originalAmount: line.originalAmount,
          originalCurrency: line.originalCurrency,
          functionalAmount: line.functionalAmount,
          functionalCurrency: line.functionalCurrency,
          fxRate: line.fxRate,
          rateSource: line.rateSource,
          rateDate: line.rateDate,
        })),
      },
    },
    include: { entries: true },
  });

  const accountIds = [
    ...new Set(input.lines.flatMap((line) => (line.accountId ? [line.accountId] : []))),
  ];
  if (accountIds.length) {
    await prisma.account.updateMany({
      where: { id: { in: accountIds } },
      data: { version: { increment: 1 } },
    });
  }
  return transaction;
}

function lineForTarget(params: {
  accountId?: string;
  categoryId?: string;
  amount: Prisma.Decimal;
  currency: string;
  functionalCurrency: string;
  rate: ResolvedRate;
  functionalAmount?: Prisma.Decimal;
}): JournalLineInput {
  return {
    accountId: params.accountId,
    categoryId: params.categoryId,
    originalAmount: params.amount,
    originalCurrency: params.currency,
    functionalAmount: params.functionalAmount ?? functional(params.amount, params.rate.rate),
    functionalCurrency: params.functionalCurrency,
    fxRate: params.rate.rate,
    rateSource: params.rate.source,
    rateDate: params.rate.date,
  };
}

async function getSystemCategory(
  prisma: PrismaClientOrTx,
  userId: string,
  key: 'INTEREST' | 'FEES'
) {
  const category = await prisma.category.findFirst({ where: { userId, systemKey: key } });
  if (!category) throw new AppError(500, 'SYSTEM_DATA_MISSING', `${key} category is missing`);
  return category;
}

export async function prepareOperation(
  prisma: PrismaClient,
  rates: RateService,
  userId: string,
  operation: CreateOperationInput
): Promise<{ type: TransactionType; description: string; date: Date; lines: JournalLineInput[] }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  const occurredOn = dateOnly(operation.date);

  if (operation.type === 'INCOME' || operation.type === 'EXPENSE') {
    const [account, category] = await Promise.all([
      prisma.account.findFirst({
        where: {
          id: operation.accountId,
          userId,
          class: 'ASSET',
          subtype: { in: ['BANK', 'CASH', 'BROKERAGE'] },
          isArchived: false,
        },
      }),
      prisma.category.findFirst({ where: { id: operation.categoryId, userId, isArchived: false } }),
    ]);
    if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
    if (!category || category.kind !== operation.type) {
      throw new AppError(
        400,
        'CATEGORY_KIND_MISMATCH',
        'Category kind does not match the operation'
      );
    }
    if (account.currency !== operation.currency) {
      throw new AppError(400, 'CURRENCY_MISMATCH', 'Currency does not match the account');
    }
    const magnitude = new Prisma.Decimal(operation.amount);
    const accountAmount = operation.type === 'INCOME' ? magnitude : magnitude.negated();
    const rate = await rates.resolve(
      account.currency,
      user.functionalCurrency,
      occurredOn,
      operation.fxRate,
      userId
    );
    return {
      type: operation.type,
      description: operation.description,
      date: occurredOn,
      lines: [
        lineForTarget({
          accountId: account.id,
          amount: accountAmount,
          currency: account.currency,
          functionalCurrency: user.functionalCurrency,
          rate,
        }),
        lineForTarget({
          categoryId: category.id,
          amount: accountAmount.negated(),
          currency: account.currency,
          functionalCurrency: user.functionalCurrency,
          rate,
        }),
      ],
    };
  }

  if (operation.type === 'TRANSFER') {
    if (operation.fromAccountId === operation.toAccountId) {
      throw new AppError(400, 'SAME_ACCOUNT_TRANSFER', 'Transfer accounts must be different');
    }
    const [from, to] = await Promise.all([
      prisma.account.findFirst({
        where: {
          id: operation.fromAccountId,
          userId,
          class: 'ASSET',
          subtype: { in: ['BANK', 'CASH', 'BROKERAGE'] },
          isArchived: false,
        },
      }),
      prisma.account.findFirst({
        where: {
          id: operation.toAccountId,
          userId,
          class: 'ASSET',
          subtype: { in: ['BANK', 'CASH', 'BROKERAGE'] },
          isArchived: false,
        },
      }),
    ]);
    if (!from || !to) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Transfer account not found');
    const fromAmount = new Prisma.Decimal(operation.fromAmount);
    const toAmount = new Prisma.Decimal(operation.toAmount);
    if (from.currency === to.currency && !fromAmount.equals(toAmount)) {
      throw new AppError(
        400,
        'TRANSFER_AMOUNT_MISMATCH',
        'Same-currency transfer amounts must match'
      );
    }
    const fromRate = await rates.resolve(
      from.currency,
      user.functionalCurrency,
      occurredOn,
      operation.fxRate,
      userId
    );
    const principalFunctional = functional(fromAmount, fromRate.rate);
    const impliedToRate: ResolvedRate = {
      rate: principalFunctional.div(toAmount),
      source: 'MANUAL',
      date: occurredOn,
    };
    const lines = [
      lineForTarget({
        accountId: from.id,
        amount: fromAmount.negated(),
        currency: from.currency,
        functionalCurrency: user.functionalCurrency,
        rate: fromRate,
        functionalAmount: principalFunctional.negated(),
      }),
      lineForTarget({
        accountId: to.id,
        amount: toAmount,
        currency: to.currency,
        functionalCurrency: user.functionalCurrency,
        rate: impliedToRate,
        functionalAmount: principalFunctional,
      }),
    ];
    if (operation.feeAmount && new Prisma.Decimal(operation.feeAmount).greaterThan(0)) {
      const fee = new Prisma.Decimal(operation.feeAmount);
      const feeCategory = await getSystemCategory(prisma, userId, 'FEES');
      lines.push(
        lineForTarget({
          accountId: from.id,
          amount: fee.negated(),
          currency: from.currency,
          functionalCurrency: user.functionalCurrency,
          rate: fromRate,
        }),
        lineForTarget({
          categoryId: feeCategory.id,
          amount: fee,
          currency: from.currency,
          functionalCurrency: user.functionalCurrency,
          rate: fromRate,
        })
      );
    }
    return { type: 'TRANSFER', description: operation.description, date: occurredOn, lines };
  }

  if (operation.type === 'LIABILITY_PAYMENT') {
    const [cash, liability, interestCategory] = await Promise.all([
      prisma.account.findFirst({
        where: {
          id: operation.cashAccountId,
          userId,
          class: 'ASSET',
          subtype: { in: ['BANK', 'CASH', 'BROKERAGE'] },
          isArchived: false,
        },
      }),
      prisma.account.findFirst({
        where: { id: operation.liabilityAccountId, userId, class: 'LIABILITY', isArchived: false },
      }),
      getSystemCategory(prisma, userId, 'INTEREST'),
    ]);
    if (!cash || !liability)
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Payment account not found');
    if (cash.currency !== liability.currency) {
      throw new AppError(
        400,
        'CURRENCY_MISMATCH',
        'Liability payment accounts must share a currency'
      );
    }
    const principal = new Prisma.Decimal(operation.principalAmount);
    const interest = new Prisma.Decimal(operation.interestAmount);
    const rate = await rates.resolve(
      cash.currency,
      user.functionalCurrency,
      occurredOn,
      operation.fxRate,
      userId
    );
    return {
      type: 'LIABILITY_PAYMENT',
      description: operation.description,
      date: occurredOn,
      lines: [
        lineForTarget({
          accountId: cash.id,
          amount: principal.add(interest).negated(),
          currency: cash.currency,
          functionalCurrency: user.functionalCurrency,
          rate,
        }),
        lineForTarget({
          accountId: liability.id,
          amount: principal,
          currency: liability.currency,
          functionalCurrency: user.functionalCurrency,
          rate,
        }),
        lineForTarget({
          categoryId: interestCategory.id,
          amount: interest,
          currency: cash.currency,
          functionalCurrency: user.functionalCurrency,
          rate,
        }),
      ],
    };
  }

  const account = await prisma.account.findFirst({
    where: { id: operation.accountId, userId, isArchived: false },
  });
  const equity = await prisma.account.findFirst({
    where: { userId, isSystem: true, class: 'EQUITY' },
  });
  if (!account || !equity)
    throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Opening-balance account not found');
  const magnitude = new Prisma.Decimal(operation.amount);
  const accountAmount = account.class === 'LIABILITY' ? magnitude.negated() : magnitude;
  const rate = await rates.resolve(
    account.currency,
    user.functionalCurrency,
    occurredOn,
    operation.fxRate,
    userId
  );
  const accountFunctional = functional(accountAmount, rate.rate);
  const equityRate: ResolvedRate = {
    rate: new Prisma.Decimal(1),
    source: 'MANUAL',
    date: occurredOn,
  };
  return {
    type: 'OPENING_BALANCE',
    description: operation.description,
    date: occurredOn,
    lines: [
      lineForTarget({
        accountId: account.id,
        amount: accountAmount,
        currency: account.currency,
        functionalCurrency: user.functionalCurrency,
        rate,
        functionalAmount: accountFunctional,
      }),
      lineForTarget({
        accountId: equity.id,
        amount: accountFunctional.negated(),
        currency: user.functionalCurrency,
        functionalCurrency: user.functionalCurrency,
        rate: equityRate,
        functionalAmount: accountFunctional.negated(),
      }),
    ],
  };
}

export async function createOperation(
  prisma: PrismaClient,
  rates: RateService,
  userId: string,
  operation: CreateOperationInput
) {
  const built = await prepareOperation(prisma, rates, userId, operation);
  return prisma.$transaction((tx) =>
    postJournal(tx, {
      userId,
      type: built.type,
      description: built.description,
      occurredOn: built.date,
      lines: built.lines,
    })
  );
}

export async function reverseTransaction(
  prisma: PrismaClient,
  userId: string,
  transactionId: string,
  description?: string
) {
  return prisma.$transaction(
    async (tx) => {
      const original = await tx.transaction.findFirst({
        where: { id: transactionId, userId },
        include: { entries: true, reversedBy: true },
      });
      if (!original) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found');
      if (original.type === 'REVERSAL' || original.reversedBy) {
        throw new AppError(409, 'ALREADY_REVERSED', 'Transaction is already reversed');
      }
      const reversal = await postJournal(tx, {
        userId,
        type: 'REVERSAL',
        description: description ?? `Reversal: ${original.description}`,
        occurredOn: original.occurredOn,
        reversalOfId: original.id,
        allowArchived: true,
        lines: original.entries.map((entry) => ({
          accountId: entry.accountId ?? undefined,
          categoryId: entry.categoryId ?? undefined,
          originalAmount: entry.originalAmount.negated(),
          originalCurrency: entry.originalCurrency,
          functionalAmount: entry.functionalAmount.negated(),
          functionalCurrency: entry.functionalCurrency,
          fxRate: entry.fxRate,
          rateSource: entry.rateSource,
          rateDate: entry.rateDate,
        })),
      });
      await tx.transaction.update({ where: { id: original.id }, data: { status: 'REVERSED' } });
      return reversal;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function replaceTransaction(
  prisma: PrismaClient,
  rates: RateService,
  userId: string,
  transactionId: string,
  replacementOperation: CreateOperationInput
) {
  const prepared = await prepareOperation(prisma, rates, userId, replacementOperation);
  return prisma.$transaction(
    async (tx) => {
      const original = await tx.transaction.findFirst({
        where: { id: transactionId, userId },
        include: { entries: true, reversedBy: true },
      });
      if (!original) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found');
      if (original.type === 'REVERSAL' || original.reversedBy) {
        throw new AppError(409, 'ALREADY_REVERSED', 'Transaction is already reversed');
      }
      await postJournal(tx, {
        userId,
        type: 'REVERSAL',
        description: `Correction: ${original.description}`,
        occurredOn: original.occurredOn,
        reversalOfId: original.id,
        allowArchived: true,
        lines: original.entries.map((entry) => ({
          accountId: entry.accountId ?? undefined,
          categoryId: entry.categoryId ?? undefined,
          originalAmount: entry.originalAmount.negated(),
          originalCurrency: entry.originalCurrency,
          functionalAmount: entry.functionalAmount.negated(),
          functionalCurrency: entry.functionalCurrency,
          fxRate: entry.fxRate,
          rateSource: entry.rateSource,
          rateDate: entry.rateDate,
        })),
      });
      await tx.transaction.update({ where: { id: original.id }, data: { status: 'REVERSED' } });
      return postJournal(tx, {
        userId,
        type: prepared.type,
        description: prepared.description,
        occurredOn: prepared.date,
        replacementForId: original.id,
        lines: prepared.lines,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function getAccountBalance(
  prisma: PrismaClientOrTx,
  accountId: string,
  through?: Date
) {
  const result = await prisma.entry.aggregate({
    where: {
      accountId,
      ...(through ? { transaction: { occurredOn: { lte: through } } } : {}),
    },
    _sum: { originalAmount: true },
  });
  return result._sum.originalAmount ?? ZERO;
}
