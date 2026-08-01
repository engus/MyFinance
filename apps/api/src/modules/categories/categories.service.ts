import { PrismaClient } from '@prisma/client';

export const SYSTEM_CATEGORY_OTHER = 'Other';
export const SYSTEM_CATEGORY_UNREALIZED_REVALUATION = 'Unrealized Revaluation';

export async function seedSystemCategories(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.category.createMany({
    data: [
      { userId, name: SYSTEM_CATEGORY_OTHER, kind: 'EXPENSE', isSystem: true },
      { userId, name: SYSTEM_CATEGORY_UNREALIZED_REVALUATION, kind: 'INCOME', isSystem: true },
    ],
  });
}
