import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import {
  createAccount,
  listAccountsWithBalances,
  updateAccount,
  deleteAccount,
  AccountNotFoundError,
} from '../modules/accounts/accounts.service';

const createAccountSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['FINANCIAL', 'ASSET']),
  currency: z.string().min(1),
});

const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
});

export function createAccountsRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuth(prisma));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const accounts = await listAccountsWithBalances(prisma, req.userId!);
      res.json(accounts);
    })
  );

  router.post(
    '/',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = createAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const account = await createAccount(prisma, { userId: req.userId!, ...parsed.data });
      res.status(201).json(account);
    })
  );

  router.patch(
    '/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const parsed = updateAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const account = await updateAccount(prisma, {
          userId: req.userId!,
          accountId: req.params.id,
          ...parsed.data,
        });
        res.json(account);
      } catch (err) {
        if (err instanceof AccountNotFoundError) {
          res.status(404).json({ error: 'Account not found' });
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
        const result = await deleteAccount(prisma, { userId: req.userId!, accountId: req.params.id });
        res.json(result);
      } catch (err) {
        if (err instanceof AccountNotFoundError) {
          res.status(404).json({ error: 'Account not found' });
          return;
        }
        throw err;
      }
    })
  );

  return router;
}
