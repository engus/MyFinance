import { PrismaClient } from '@prisma/client';
import { seedCategories } from '../../src/modules/categories/categories.service';

export async function seedLedgerUser(
  prisma: PrismaClient,
  email = 'owner@example.com',
  options: { reconciliationMode?: 'AUTO' | 'CONFIRM'; functionalCurrency?: string } = {}
) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: 'test-only-hash',
      functionalCurrency: options.functionalCurrency ?? 'USD',
      displayCurrency: options.functionalCurrency ?? 'USD',
      reconciliationMode: options.reconciliationMode ?? 'AUTO',
    },
  });
  const equity = await prisma.account.create({
    data: {
      userId: user.id,
      name: 'Opening balance equity',
      class: 'EQUITY',
      subtype: 'OTHER',
      currency: user.functionalCurrency,
      isSystem: true,
    },
  });
  await seedCategories(prisma, user.id);
  return { user, equity };
}
