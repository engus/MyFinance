import { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/errors';

type Db = PrismaClient | Prisma.TransactionClient;

const SYSTEM_CATEGORIES = [
  { name: 'Other income', kind: 'INCOME', systemKey: 'OTHER_INCOME', affectsCashflow: true },
  { name: 'Other expense', kind: 'EXPENSE', systemKey: 'OTHER_EXPENSE', affectsCashflow: true },
  { name: 'Unrealized gain', kind: 'INCOME', systemKey: 'UNREALIZED_GAIN', affectsCashflow: false },
  {
    name: 'Unrealized loss',
    kind: 'EXPENSE',
    systemKey: 'UNREALIZED_LOSS',
    affectsCashflow: false,
  },
  { name: 'Interest', kind: 'EXPENSE', systemKey: 'INTEREST', affectsCashflow: true },
  { name: 'Fees', kind: 'EXPENSE', systemKey: 'FEES', affectsCashflow: true },
] as const;

const DEFAULT_CATEGORIES = [
  { name: 'Salary', kind: 'INCOME' },
  { name: 'Business income', kind: 'INCOME' },
  { name: 'Dividends', kind: 'INCOME' },
  { name: 'Groceries', kind: 'EXPENSE' },
  { name: 'Housing', kind: 'EXPENSE' },
  { name: 'Transport', kind: 'EXPENSE' },
  { name: 'Utilities', kind: 'EXPENSE' },
  { name: 'Health', kind: 'EXPENSE' },
  { name: 'Entertainment', kind: 'EXPENSE' },
  { name: 'Travel', kind: 'EXPENSE' },
] as const;

export async function seedCategories(prisma: Db, userId: string): Promise<void> {
  await prisma.category.createMany({
    data: [
      ...SYSTEM_CATEGORIES.map((category) => ({ ...category, userId, isSystem: true })),
      ...DEFAULT_CATEGORIES.map((category) => ({ ...category, userId })),
    ],
  });
}

export async function listCategories(
  prisma: PrismaClient,
  userId: string,
  includeArchived = false
) {
  return prisma.category.findMany({
    where: { userId, ...(includeArchived ? {} : { isArchived: false }) },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  });
}

export async function createCategory(
  prisma: PrismaClient,
  userId: string,
  input: { name: string; kind: 'INCOME' | 'EXPENSE' }
) {
  try {
    return await prisma.category.create({ data: { userId, name: input.name, kind: input.kind } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'CATEGORY_NAME_EXISTS', 'A category with this name already exists');
    }
    throw error;
  }
}

export async function updateCategory(
  prisma: PrismaClient,
  userId: string,
  categoryId: string,
  input: { name?: string; isArchived?: boolean }
) {
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
  if (category.isSystem)
    throw new AppError(403, 'SYSTEM_CATEGORY', 'System categories cannot be changed');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.category.update({ where: { id: categoryId }, data: input });
    if (input.isArchived) {
      await tx.recurringTemplate.updateMany({
        where: { userId, lines: { some: { categoryId } }, status: 'ACTIVE' },
        data: { status: 'PAUSED' },
      });
    }
    return updated;
  });
}
