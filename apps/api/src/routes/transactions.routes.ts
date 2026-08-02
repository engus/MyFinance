import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import {
  createTransaction,
  InvalidEntryError,
  UnbalancedTransactionError,
} from '../modules/ledger/ledger.service';
import {
  createRecurringTemplate,
  listTransactions,
  updateRecurringTemplate,
  updateOneOffTransaction,
  deleteTransaction,
  TransactionNotFoundError,
  NotARecurringTemplateError,
  NotAOneOffTransactionError,
} from '../modules/transactions/transactions.service';

const amountSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Invalid amount');

const entrySchema = z.object({
  accountId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  amount: amountSchema,
  currency: z.string().min(1),
});

const createOneOffSchema = z.object({
  description: z.string().min(1),
  date: z.coerce.date(),
  entries: z.tuple([entrySchema, entrySchema]),
});

const createRecurringSchema = z
  .object({
    description: z.string().min(1),
    accountId: z.string().min(1),
    categoryId: z.string().min(1),
    amount: amountSchema,
    currency: z.string().min(1),
    interval: z.enum(['WEEK', 'MONTH', 'QUARTER', 'YEAR', 'CUSTOM']),
    customDays: z.number().int().positive().optional(),
    startDate: z.coerce.date(),
  })
  .superRefine((data, ctx) => {
    if (data.interval === 'CUSTOM' && data.customDays === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'customDays is required when interval is CUSTOM',
        path: ['customDays'],
      });
    }
  });

const updateOneOffSchema = z.object({
  description: z.string().min(1).optional(),
  date: z.coerce.date().optional(),
  entries: z.tuple([entrySchema, entrySchema]),
});

const updateRecurringSchema = z
  .object({
    amount: amountSchema.optional(),
    interval: z.enum(['WEEK', 'MONTH', 'QUARTER', 'YEAR', 'CUSTOM']).optional(),
    customDays: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.interval === 'CUSTOM' && data.customDays === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'customDays is required when interval is CUSTOM',
        path: ['customDays'],
      });
    }
  });

function handleServiceError(res: import('express').Response, err: unknown): boolean {
  if (
    err instanceof TransactionNotFoundError
  ) {
    res.status(404).json({ error: 'Transaction not found' });
    return true;
  }
  if (
    err instanceof NotAOneOffTransactionError ||
    err instanceof NotARecurringTemplateError ||
    err instanceof InvalidEntryError ||
    err instanceof UnbalancedTransactionError
  ) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

export function createTransactionsRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuth(prisma));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const kind = req.query.kind as 'INCOME' | 'EXPENSE' | undefined;
      const frequency = req.query.frequency as 'ONE_OFF' | 'RECURRING' | undefined;
      const accountId = req.query.accountId as string | undefined;
      const transactions = await listTransactions(prisma, req.userId!, { kind, frequency, accountId });
      res.json(transactions);
    })
  );

  router.post(
    '/',
    requireCsrf,
    asyncHandler(async (req, res) => {
      if (Array.isArray(req.body?.entries)) {
        const parsed = createOneOffSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        try {
          const transaction = await createTransaction(prisma, { userId: req.userId!, ...parsed.data });
          res.status(201).json(transaction);
        } catch (err) {
          if (handleServiceError(res, err)) return;
          throw err;
        }
        return;
      }

      const parsed = createRecurringSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const template = await createRecurringTemplate(prisma, { userId: req.userId!, ...parsed.data });
        res.status(201).json(template);
      } catch (err) {
        if (handleServiceError(res, err)) return;
        throw err;
      }
    })
  );

  router.patch(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      try {
        if (Array.isArray(req.body?.entries)) {
          const parsed = updateOneOffSchema.safeParse(req.body);
          if (!parsed.success) {
            res.status(400).json({ error: parsed.error.flatten() });
            return;
          }
          const transaction = await updateOneOffTransaction(prisma, {
            userId: req.userId!,
            transactionId: req.params.id,
            ...parsed.data,
          });
          res.json(transaction);
          return;
        }

        const parsed = updateRecurringSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        const template = await updateRecurringTemplate(prisma, {
          userId: req.userId!,
          transactionId: req.params.id,
          ...parsed.data,
        });
        res.json(template);
      } catch (err) {
        if (handleServiceError(res, err)) return;
        throw err;
      }
    })
  );

  router.delete(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      try {
        const result = await deleteTransaction(prisma, {
          userId: req.userId!,
          transactionId: req.params.id,
        });
        res.json(result);
      } catch (err) {
        if (handleServiceError(res, err)) return;
        throw err;
      }
    })
  );

  return router;
}
