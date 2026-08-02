import { PrismaClient, Prisma } from '@prisma/client';

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

export class CategoryNotFoundError extends Error {}
export class SystemCategoryError extends Error {}
export class DuplicateCategoryNameError extends Error {}

export async function listCategories(
  prisma: PrismaClient,
  userId: string,
  options: { includeInactive?: boolean } = {}
) {
  return prisma.category.findMany({
    where: { userId, ...(options.includeInactive ? {} : { isActive: true }) },
    orderBy: { name: 'asc' },
  });
}

export async function createCategory(
  prisma: PrismaClient,
  params: { userId: string; name: string; kind: 'INCOME' | 'EXPENSE' }
) {
  try {
    return await prisma.category.create({
      data: { userId: params.userId, name: params.name, kind: params.kind },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateCategoryNameError(`Category "${params.name}" already exists`);
    }
    throw err;
  }
}

export async function updateCategory(
  prisma: PrismaClient,
  params: { userId: string; categoryId: string; name: string }
) {
  const category = await prisma.category.findFirst({
    where: { id: params.categoryId, userId: params.userId },
  });
  if (!category) throw new CategoryNotFoundError();
  if (category.isSystem) throw new SystemCategoryError('System categories cannot be edited');

  try {
    return await prisma.category.update({
      where: { id: params.categoryId },
      data: { name: params.name },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateCategoryNameError(`Category "${params.name}" already exists`);
    }
    throw err;
  }
}

export async function deleteCategory(
  prisma: PrismaClient,
  params: { userId: string; categoryId: string }
): Promise<{ hardDeleted: boolean }> {
  const category = await prisma.category.findFirst({
    where: { id: params.categoryId, userId: params.userId },
  });
  if (!category) throw new CategoryNotFoundError();
  if (category.isSystem) throw new SystemCategoryError('System categories cannot be deleted');

  const entryCount = await prisma.entry.count({ where: { categoryId: params.categoryId } });
  if (entryCount === 0) {
    await prisma.category.delete({ where: { id: params.categoryId } });
    return { hardDeleted: true };
  }

  await prisma.category.update({ where: { id: params.categoryId }, data: { isActive: false } });
  return { hardDeleted: false };
}
