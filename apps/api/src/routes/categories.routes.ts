import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  CategoryNotFoundError,
  SystemCategoryError,
  DuplicateCategoryNameError,
} from '../modules/categories/categories.service';

const createCategorySchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['INCOME', 'EXPENSE']),
});

const updateCategorySchema = z.object({
  name: z.string().min(1),
});

export function createCategoriesRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuth(prisma));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const includeInactive = req.query.includeInactive === 'true';
      const categories = await listCategories(prisma, req.userId!, { includeInactive });
      res.json(categories);
    })
  );

  router.post(
    '/',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = createCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const category = await createCategory(prisma, { userId: req.userId!, ...parsed.data });
        res.status(201).json(category);
      } catch (err) {
        if (err instanceof DuplicateCategoryNameError) {
          res.status(409).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  router.patch(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = updateCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const category = await updateCategory(prisma, {
          userId: req.userId!,
          categoryId: req.params.id,
          name: parsed.data.name,
        });
        res.json(category);
      } catch (err) {
        if (err instanceof CategoryNotFoundError) {
          res.status(404).json({ error: 'Category not found' });
          return;
        }
        if (err instanceof SystemCategoryError) {
          res.status(403).json({ error: err.message });
          return;
        }
        if (err instanceof DuplicateCategoryNameError) {
          res.status(409).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  router.delete(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      try {
        const result = await deleteCategory(prisma, { userId: req.userId!, categoryId: req.params.id });
        res.json(result);
      } catch (err) {
        if (err instanceof CategoryNotFoundError) {
          res.status(404).json({ error: 'Category not found' });
          return;
        }
        if (err instanceof SystemCategoryError) {
          res.status(403).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  return router;
}
