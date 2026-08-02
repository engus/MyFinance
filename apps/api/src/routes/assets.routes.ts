import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { createAssetSchema, createValuationSchema, moneySchema } from '@myfinance/contracts';
import { asyncHandler } from '../lib/asyncHandler';
import { parseBody } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import {
  createAsset,
  listAssets,
  recordValuation,
  updateAsset,
} from '../modules/assets/assets.service';
import { RateService } from '../modules/rates/rates.service';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  region: z.string().trim().max(120).optional(),
  institution: z.string().trim().max(120).optional(),
  ownershipShare: moneySchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  isArchived: z.boolean().optional(),
});
export function createAssetsRouter(prisma: PrismaClient, rates: RateService) {
  const router = Router();
  router.use(requireAuth(prisma));
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await listAssets(prisma, req.userId!));
    })
  );
  router.post(
    '/',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          await createAsset(prisma, rates, req.userId!, parseBody(createAssetSchema, req.body))
        );
    })
  );
  router.patch(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(
        await updateAsset(prisma, req.userId!, req.params.id, parseBody(updateSchema, req.body))
      );
    })
  );
  router.delete(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(await updateAsset(prisma, req.userId!, req.params.id, { isArchived: true }));
    })
  );
  router.post(
    '/:id/valuations',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          await recordValuation(
            prisma,
            rates,
            req.userId!,
            req.params.id,
            parseBody(createValuationSchema, req.body)
          )
        );
    })
  );
  return router;
}
