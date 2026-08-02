import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { dateSchema, recurrenceSchema } from '@myfinance/contracts';
import { asyncHandler } from '../lib/asyncHandler';
import { parseBody } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import {
  createRecurringTemplate,
  listRecurringTemplates,
  updateRecurringTemplate,
} from '../modules/recurring/recurring.service';
import { RateService } from '../modules/rates/rates.service';

const updateSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  nextRunDate: dateSchema.optional(),
});

export function createRecurringRouter(prisma: PrismaClient, rates: RateService) {
  const router = Router();
  router.use(requireAuth(prisma));
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await listRecurringTemplates(prisma, req.userId!));
    })
  );
  router.post(
    '/',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          await createRecurringTemplate(
            prisma,
            rates,
            req.userId!,
            parseBody(recurrenceSchema, req.body)
          )
        );
    })
  );
  router.patch(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(
        await updateRecurringTemplate(
          prisma,
          req.userId!,
          req.params.id,
          parseBody(updateSchema, req.body)
        )
      );
    })
  );
  router.delete(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(
        await updateRecurringTemplate(prisma, req.userId!, req.params.id, { status: 'ARCHIVED' })
      );
    })
  );
  return router;
}
