import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { getDashboard } from '../modules/dashboard/dashboard.service';
import { RateService } from '../modules/rates/rates.service';

export function createDashboardRouter(prisma: PrismaClient, rates: RateService) {
  const router = Router();
  router.use(requireAuth(prisma));
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await getDashboard(prisma, rates, req.userId!));
    })
  );
  return router;
}
