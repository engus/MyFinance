import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

export const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST } },
});

export async function truncateAll() {
  await testPrisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Entry", "Transaction", "ExchangeRate", "Category", "Account", "Session", "User" RESTART IDENTITY CASCADE'
  );
}
