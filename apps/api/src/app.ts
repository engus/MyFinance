import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { AppError } from './lib/errors';
import { YahooRateProvider } from './modules/rates/yahooRateProvider';
import { RateService } from './modules/rates/rates.service';
import { createAuthRouter } from './routes/auth.routes';
import { createAccountsRouter } from './routes/accounts.routes';
import { createCategoriesRouter } from './routes/categories.routes';
import { createTransactionsRouter } from './routes/transactions.routes';
import { createRecurringRouter } from './routes/recurring.routes';
import { createAssetsRouter } from './routes/assets.routes';
import { createLiabilitiesRouter } from './routes/liabilities.routes';
import { createDashboardRouter } from './routes/dashboard.routes';
import { createSettingsRouter } from './routes/settings.routes';

export function createApp(prisma: PrismaClient) {
  const app = express();
  const production = process.env.NODE_ENV === 'production';
  const cookieName = production ? '__Host-sid' : 'sid';
  const yahoo = new YahooRateProvider();
  const rates = new RateService(prisma, yahoo);

  app.disable('x-powered-by');
  const trustedProxy = process.env.TRUST_PROXY;
  if (trustedProxy && trustedProxy !== 'false') {
    app.set(
      'trust proxy',
      trustedProxy === 'true' ? 1 : /^\d+$/.test(trustedProxy) ? Number(trustedProxy) : trustedProxy
    );
  }
  app.use((req, res, next) => {
    const startedAt = performance.now();
    const requestId = req.get('x-request-id')?.slice(0, 100) || crypto.randomUUID();
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
    );
    res.on('finish', () => {
      console.log(
        JSON.stringify({
          level: 'info',
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Number((performance.now() - startedAt).toFixed(1)),
        })
      );
    });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  const cookieOptions: express.CookieOptions = {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
  };
  const cookies = {
    set(res: express.Response, session: { token: string; expiresAt: Date }) {
      res.cookie(cookieName, session.token, { ...cookieOptions, expires: session.expiresAt });
    },
    clear(res: express.Response) {
      res.clearCookie(cookieName, cookieOptions);
    },
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });

  app.use('/api/auth', createAuthRouter(prisma, cookies));
  app.use('/api/accounts', createAccountsRouter(prisma, rates));
  app.use('/api/categories', createCategoriesRouter(prisma));
  app.use('/api/transactions', createTransactionsRouter(prisma, rates));
  app.use('/api/recurring', createRecurringRouter(prisma, rates));
  app.use('/api/assets', createAssetsRouter(prisma, rates));
  app.use('/api/liabilities', createLiabilitiesRouter(prisma, rates));
  app.use('/api/dashboard', createDashboardRouter(prisma, rates));
  app.use('/api/settings', createSettingsRouter(prisma, rates));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
  app.use(
    (error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next;
      const requestId = res.getHeader('x-request-id');
      if (error instanceof AppError) {
        res
          .status(error.status)
          .json({ error: { code: error.code, message: error.message, fields: error.fields } });
        return;
      }
      if (error instanceof SyntaxError && 'body' in error) {
        res
          .status(400)
          .json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
        return;
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'type' in error &&
        error.type === 'entity.too.large'
      ) {
        res
          .status(413)
          .json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
        return;
      }
      console.error(
        JSON.stringify({
          level: 'error',
          requestId,
          method: req.method,
          path: req.path,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      );
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    }
  );
  return app;
}
