import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  createAccountSchema,
  dateSchema,
  signedMoneySchema,
  updateAccountSchema,
  moneySchema,
} from '@myfinance/contracts';
import { asyncHandler } from '../lib/asyncHandler';
import { parseBody } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import {
  createAccount,
  listAccountsWithBalances,
  updateAccount,
} from '../modules/accounts/accounts.service';
import {
  confirmReconciliation,
  previewReconciliation,
} from '../modules/reconciliation/reconciliation.service';
import { RateService } from '../modules/rates/rates.service';

const previewSchema = z.object({
  statedBalance: signedMoneySchema,
  date: dateSchema,
  fxRate: moneySchema.optional(),
});
const confirmSchema = z.object({ fxRate: moneySchema.optional() });

export function createAccountsRouter(prisma: PrismaClient, rates: RateService): Router {
  const router = Router();
  router.use(requireAuth(prisma));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(
        await listAccountsWithBalances(prisma, req.userId!, req.query.includeArchived === 'true')
      );
    })
  );
  router.post(
    '/',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          await createAccount(prisma, rates, req.userId!, parseBody(createAccountSchema, req.body))
        );
    })
  );
  router.patch(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(
        await updateAccount(
          prisma,
          req.userId!,
          req.params.id,
          parseBody(updateAccountSchema, req.body)
        )
      );
    })
  );
  router.delete(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(await updateAccount(prisma, req.userId!, req.params.id, { isArchived: true }));
    })
  );
  router.post(
    '/:id/reconciliations/preview',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const input = parseBody(previewSchema, req.body);
      const result = await previewReconciliation(prisma, rates, req.userId!, {
        accountId: req.params.id,
        ...input,
      });
      res.status(result.requiresConfirmation ? 202 : 201).json(result);
    })
  );
  router.post(
    '/reconciliations/:id/confirm',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const input = parseBody(confirmSchema, req.body);
      res.json(
        await confirmReconciliation(prisma, rates, req.userId!, req.params.id, input.fxRate)
      );
    })
  );
  return router;
}
