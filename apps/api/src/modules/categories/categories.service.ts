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

export async function seedDefaultCategories(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.category.createMany({
    data: [
      { userId, name: 'Зарплата', kind: 'INCOME' },
      { userId, name: 'Прочий доход', kind: 'INCOME' },
      { userId, name: 'Продукты', kind: 'EXPENSE' },
      { userId, name: 'Аренда/Жильё', kind: 'EXPENSE' },
      { userId, name: 'Авто', kind: 'EXPENSE' },
      { userId, name: 'Коммунальные', kind: 'EXPENSE' },
      { userId, name: 'Кредиты', kind: 'EXPENSE' },
      { userId, name: 'Развлечения', kind: 'EXPENSE' },
      { userId, name: 'Здоровье', kind: 'EXPENSE' },
      { userId, name: 'Прочие расходы', kind: 'EXPENSE' },
    ],
  });
}
