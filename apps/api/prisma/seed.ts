import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { seedCategories } from '../src/modules/categories/categories.service';
import { RateService } from '../src/modules/rates/rates.service';
import { createAccount } from '../src/modules/accounts/accounts.service';
import { createOperation } from '../src/modules/ledger/ledger.service';
import { createAsset } from '../src/modules/assets/assets.service';
import { createLiability } from '../src/modules/liabilities/liabilities.service';

const prisma = new PrismaClient();
const email = process.env.DEMO_EMAIL?.trim().toLowerCase() || 'demo@myfinance.local';
const password = process.env.DEMO_PASSWORD || 'MyFinance-Demo-2026!';

async function main() {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(JSON.stringify({ message: 'Demo user already exists', email }));
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        passwordHash,
        functionalCurrency: 'USD',
        displayCurrency: 'USD',
        timezone: 'America/New_York',
        reconciliationMode: 'CONFIRM',
      },
    });
    await tx.account.create({
      data: {
        userId: created.id,
        name: 'Opening balance equity',
        class: 'EQUITY',
        subtype: 'OTHER',
        currency: 'USD',
        isSystem: true,
      },
    });
    await seedCategories(tx, created.id);
    return created;
  });

  const rates = new RateService(prisma);
  const checking = await createAccount(prisma, rates, user.id, {
    name: 'Everyday checking',
    class: 'ASSET',
    subtype: 'BANK',
    currency: 'USD',
    institution: 'Demo Bank',
    countryCode: 'US',
    openingBalance: '12500.00',
    openingDate: '2026-01-01',
  });
  const euroCash = await createAccount(prisma, rates, user.id, {
    name: 'Euro travel cash',
    class: 'ASSET',
    subtype: 'CASH',
    currency: 'EUR',
    openingBalance: '1800.00',
    openingDate: '2026-01-01',
    openingFxRate: '1.04',
  });
  const salary = await prisma.category.findFirstOrThrow({
    where: { userId: user.id, name: 'Salary' },
  });
  const groceries = await prisma.category.findFirstOrThrow({
    where: { userId: user.id, name: 'Groceries' },
  });
  const travel = await prisma.category.findFirstOrThrow({
    where: { userId: user.id, name: 'Travel' },
  });

  await createOperation(prisma, rates, user.id, {
    type: 'INCOME',
    description: 'Monthly salary',
    date: '2026-07-31',
    accountId: checking.id,
    categoryId: salary.id,
    amount: '6200.00',
    currency: 'USD',
  });
  await createOperation(prisma, rates, user.id, {
    type: 'EXPENSE',
    description: 'Household groceries',
    date: '2026-08-01',
    accountId: checking.id,
    categoryId: groceries.id,
    amount: '286.45',
    currency: 'USD',
  });
  await createOperation(prisma, rates, user.id, {
    type: 'EXPENSE',
    description: 'Museum and rail tickets',
    date: '2026-07-18',
    accountId: euroCash.id,
    categoryId: travel.id,
    amount: '214.20',
    currency: 'EUR',
    fxRate: '1.08',
  });
  await createOperation(prisma, rates, user.id, {
    type: 'TRANSFER',
    description: 'Travel cash',
    date: '2026-07-10',
    fromAccountId: checking.id,
    toAccountId: euroCash.id,
    fromAmount: '1080.00',
    toAmount: '1000.00',
    fxRate: '1',
    feeAmount: '4.00',
  });

  await createAsset(prisma, rates, user.id, {
    name: 'Family apartment',
    type: 'REAL_ESTATE',
    currency: 'USD',
    initialValue: '315000.00',
    valuationDate: '2026-01-01',
    ownershipShare: '100',
    countryCode: 'US',
    region: 'New York',
    notes: 'Manual demonstration valuation',
  });
  await createAsset(prisma, rates, user.id, {
    name: 'Global index position',
    type: 'SECURITY',
    currency: 'USD',
    initialValue: '18450.00',
    valuationDate: '2026-01-01',
    ownershipShare: '100',
    institution: 'Demo Brokerage',
    notes: 'Manually updated monthly portfolio value',
  });
  await createLiability(prisma, rates, user.id, {
    name: 'Home mortgage',
    subtype: 'MORTGAGE',
    currency: 'USD',
    openingBalance: '196000.00',
    openingDate: '2026-01-01',
    creditor: 'Demo Credit Union',
    annualInterestRate: '4.25',
    maturityDate: '2049-12-01',
  });

  console.log(JSON.stringify({ message: 'Demo data created', email, password }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
