import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { loginSchema, registrationSchema } from '@myfinance/contracts';
import { asyncHandler } from '../lib/asyncHandler';
import { parseBody, requestMetadata } from '../lib/http';
import { destroySession } from '../lib/session';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import { beginLogin, completeLogin, registerUser } from '../modules/auth/auth.service';

const verifySchema = z.object({
  challengeToken: z.string().min(20),
  code: z.string().min(6).max(32),
});

export function createAuthRouter(
  prisma: PrismaClient,
  cookies: {
    set: (res: import('express').Response, session: { token: string; expiresAt: Date }) => void;
    clear: (res: import('express').Response) => void;
  }
) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many authentication attempts; try again later',
        },
      });
    },
  });

  router.post(
    '/register',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(registrationSchema, req.body);
      const { user, session } = await registerUser(prisma, input, requestMetadata(req));
      cookies.set(res, session);
      res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          displayCurrency: user.displayCurrency,
          timezone: user.timezone,
          totpEnabled: user.totpEnabled,
        },
        csrfToken: session.csrfToken,
      });
    })
  );

  router.post(
    '/login',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(loginSchema, req.body);
      const result = await beginLogin(prisma, input.email, input.password, requestMetadata(req));
      if (result.requiresTotp) {
        res.status(202).json({ requiresTotp: true, challengeToken: result.challengeToken });
        return;
      }
      cookies.set(res, result.session);
      res.json({
        requiresTotp: false,
        user: {
          id: result.user.id,
          email: result.user.email,
          displayCurrency: result.user.displayCurrency,
          timezone: result.user.timezone,
          totpEnabled: result.user.totpEnabled,
        },
        csrfToken: result.session.csrfToken,
      });
    })
  );

  router.post(
    '/verify-2fa',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(verifySchema, req.body);
      const result = await completeLogin(
        prisma,
        input.challengeToken,
        input.code,
        requestMetadata(req)
      );
      cookies.set(res, result.session);
      res.json({
        user: {
          id: result.user.id,
          email: result.user.email,
          displayCurrency: result.user.displayCurrency,
          timezone: result.user.timezone,
          totpEnabled: result.user.totpEnabled,
        },
        csrfToken: result.session.csrfToken,
      });
    })
  );

  router.get(
    '/me',
    requireAuth(prisma),
    asyncHandler(async (req, res) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: req.userId! },
        select: { id: true, email: true, displayCurrency: true, timezone: true, totpEnabled: true },
      });
      res.json({ user, csrfToken: req.sessionRecord!.csrfToken });
    })
  );

  router.post(
    '/logout',
    requireAuth(prisma),
    requireCsrf,
    asyncHandler(async (req, res) => {
      await destroySession(prisma, req.cookies.sid ?? req.cookies['__Host-sid']);
      cookies.clear(res);
      res.status(204).send();
    })
  );

  return router;
}
