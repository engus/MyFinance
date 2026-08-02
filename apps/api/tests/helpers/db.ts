import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

export const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST } },
});

export async function truncateAll() {
  await testPrisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AssetValuation", "AssetProfile", "LiabilityProfile", "Reconciliation", "RecurringOccurrence", "RecurringLine", "RecurringTemplate", "ExchangeRate", "Entry", "Transaction", "RecoveryCode", "LoginChallenge", "Session", "Category", "Account", "User" RESTART IDENTITY CASCADE'
  );
}
