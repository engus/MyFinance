import { Router } from 'express';
import { PrismaClient, TransactionType } from '@prisma/client';
import { z } from 'zod';
import { createOperationSchema, dateSchema } from '@myfinance/contracts';
import { asyncHandler } from '../lib/asyncHandler';
import { parseBody } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import {
  createOperation,
  replaceTransaction,
  reverseTransaction,
} from '../modules/ledger/ledger.service';
import { RateService } from '../modules/rates/rates.service';
import { listTransactions } from '../modules/transactions/transactions.service';

const querySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  type: z
    .enum([
      'INCOME',
      'EXPENSE',
      'TRANSFER',
      'OPENING_BALANCE',
      'LIABILITY_PAYMENT',
      'VALUATION',
      'REVERSAL',
    ])
    .optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const reverseSchema = z.object({ description: z.string().trim().min(1).max(240).optional() });

export function createTransactionsRouter(prisma: PrismaClient, rates: RateService): Router {
  const router = Router();
  router.use(requireAuth(prisma));
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const filters = parseBody(querySchema, req.query);
      res.json(
        await listTransactions(prisma, req.userId!, {
          ...filters,
          type: filters.type as TransactionType | undefined,
        })
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
          await createOperation(
            prisma,
            rates,
            req.userId!,
            parseBody(createOperationSchema, req.body)
          )
        );
    })
  );
  router.post(
    '/:id/reverse',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const input = parseBody(reverseSchema, req.body);
      res
        .status(201)
        .json(await reverseTransaction(prisma, req.userId!, req.params.id, input.description));
    })
  );
  router.post(
    '/:id/replace',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          await replaceTransaction(
            prisma,
            rates,
            req.userId!,
            req.params.id,
            parseBody(createOperationSchema, req.body)
          )
        );
    })
  );
  return router;
}
