import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { manualRateSchema, settingsSchema } from '@myfinance/contracts';
import { asyncHandler } from '../lib/asyncHandler';
import { parseBody } from '../lib/http';
import { listSessions, revokeSession } from '../lib/session';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import { beginTotpSetup, confirmTotpSetup, disableTotp } from '../modules/auth/auth.service';
import {
  deleteUserAccount,
  getSettings,
  updateCredentials,
  updateSettings,
} from '../modules/settings/settings.service';
import { RateService } from '../modules/rates/rates.service';

const confirmTotpSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const disableTotpSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/),
});
const credentialsSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newEmail: z.string().trim().email().max(254).optional(),
  newPassword: z.string().min(12).max(128).optional(),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
const deleteSchema = z.object({
  password: z.string().min(1).max(128),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

function token(req: import('express').Request): string {
  return (req.cookies.sid ?? req.cookies['__Host-sid']) as string;
}

export function createSettingsRouter(prisma: PrismaClient, rates: RateService) {
  const router = Router();
  router.use(requireAuth(prisma));
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await getSettings(prisma, req.userId!));
    })
  );
  router.patch(
    '/',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(await updateSettings(prisma, req.userId!, parseBody(settingsSchema, req.body)));
    })
  );
  router.post(
    '/rates',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const input = parseBody(manualRateSchema, req.body);
      const resolved = await rates.resolve(
        input.fromCurrency,
        input.toCurrency,
        new Date(`${input.date}T00:00:00.000Z`),
        input.rate,
        req.userId!
      );
      res.status(201).json({
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        date: input.date,
        rate: resolved.rate.toString(),
        source: resolved.source,
      });
    })
  );
  router.put(
    '/credentials',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const input = parseBody(credentialsSchema, req.body);
      const user = await updateCredentials(prisma, req.userId!, token(req), input);
      res.json({ id: user.id, email: user.email });
    })
  );
  router.delete(
    '/account',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const input = parseBody(deleteSchema, req.body);
      await deleteUserAccount(prisma, req.userId!, input.password, input.totpCode);
      const production = process.env.NODE_ENV === 'production';
      res.clearCookie(production ? '__Host-sid' : 'sid', {
        httpOnly: true,
        secure: production,
        sameSite: 'lax',
        path: '/',
      });
      res.status(204).send();
    })
  );
  router.get(
    '/sessions',
    asyncHandler(async (req, res) => {
      res.json(await listSessions(prisma, req.userId!, token(req)));
    })
  );
  router.delete(
    '/sessions/:id',
    requireCsrf,
    asyncHandler(async (req, res) => {
      await revokeSession(prisma, req.userId!, req.params.id, token(req));
      res.status(204).send();
    })
  );
  router.post(
    '/2fa/setup',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(await beginTotpSetup(prisma, req.userId!));
    })
  );
  router.post(
    '/2fa/confirm',
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(
        await confirmTotpSetup(prisma, req.userId!, parseBody(confirmTotpSchema, req.body).code)
      );
    })
  );
  router.post(
    '/2fa/disable',
    requireCsrf,
    asyncHandler(async (req, res) => {
      const input = parseBody(disableTotpSchema, req.body);
      await disableTotp(prisma, req.userId!, input.password, input.code);
      res.status(204).send();
    })
  );
  return router;
}
