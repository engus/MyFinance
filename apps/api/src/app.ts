import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import {
  registerUser,
  loginUser,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from './modules/auth/auth.service';
import { destroySession } from './lib/session';
import { requireAuth } from './middleware/auth';
import { requireCsrf } from './middleware/csrf';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export function createApp(prisma: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
  });

  function setSessionCookie(
    res: express.Response,
    session: { token: string; expiresAt: Date }
  ) {
    res.cookie('sid', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: session.expiresAt,
    });
  }

  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const { user, session } = await registerUser(prisma, parsed.data.email, parsed.data.password);
      setSessionCookie(res, session);
      res.status(201).json({ id: user.id, email: user.email, csrfToken: session.csrfToken });
    } catch (err) {
      if (err instanceof EmailAlreadyRegisteredError) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
      throw err;
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const { user, session } = await loginUser(prisma, parsed.data.email, parsed.data.password);
      setSessionCookie(res, session);
      res.json({ id: user.id, email: user.email, csrfToken: session.csrfToken });
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }
      throw err;
    }
  });

  app.post('/api/auth/logout', requireAuth(prisma), requireCsrf, async (req, res) => {
    await destroySession(prisma, req.cookies.sid);
    res.clearCookie('sid');
    res.status(204).send();
  });

  app.get('/api/auth/me', requireAuth(prisma), async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
    res.json({ id: user.id, email: user.email });
  });

  return app;
}
