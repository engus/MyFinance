import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { createCategorySchema } from '@myfinance/contracts';
import { asyncHandler } from '../lib/asyncHandler';
import { parseBody } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import {
  createCategory,
  listCategories,
  updateCategory,
} from '../modules/categories/categories.service';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  isArchived: z.boolean().optional(),
});

export function createCategoriesRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuth(prisma));
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await listCategories(prisma, req.userId!, req.query.includeArchived === 'true'));
    })
  );
  router.post(
    '/',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(await createCategory(prisma, req.userId!, parseBody(createCategorySchema, req.body)));
    })
  );
  router.patch(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(
        await updateCategory(prisma, req.userId!, req.params.id, parseBody(updateSchema, req.body))
      );
    })
  );
  router.delete(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(await updateCategory(prisma, req.userId!, req.params.id, { isArchived: true }));
    })
  );
  return router;
}
