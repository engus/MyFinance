import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { createLiabilitySchema, dateSchema, moneySchema } from '@myfinance/contracts';
import { asyncHandler } from '../lib/asyncHandler';
import { parseBody } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import {
  createLiability,
  listLiabilities,
  updateLiability,
} from '../modules/liabilities/liabilities.service';
import { RateService } from '../modules/rates/rates.service';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  creditor: z.string().trim().max(120).optional(),
  annualInterestRate: moneySchema.optional(),
  maturityDate: dateSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  isArchived: z.boolean().optional(),
});

export function createLiabilitiesRouter(prisma: PrismaClient, rates: RateService) {
  const router = Router();
  router.use(requireAuth(prisma));
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await listLiabilities(prisma, req.userId!));
    })
  );
  router.post(
    '/',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          await createLiability(
            prisma,
            rates,
            req.userId!,
            parseBody(createLiabilitySchema, req.body)
          )
        );
    })
  );
  router.patch(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(
        await updateLiability(prisma, req.userId!, req.params.id, parseBody(updateSchema, req.body))
      );
    })
  );
  router.delete(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(await updateLiability(prisma, req.userId!, req.params.id, { isArchived: true }));
    })
  );
  return router;
}
