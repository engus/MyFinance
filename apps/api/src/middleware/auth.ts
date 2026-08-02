import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { getSession } from '../lib/session';
import { AppError } from '../lib/errors';

export function requireAuth(prisma: PrismaClient) {
  return (req: Request, res: Response, next: NextFunction) => {
    handleAuth(prisma, req, res, next).catch(next);
  };
}

async function handleAuth(prisma: PrismaClient, req: Request, res: Response, next: NextFunction) {
  const token = (req.cookies?.sid ?? req.cookies?.['__Host-sid']) as string | undefined;
  if (!token) {
    next(new AppError(401, 'NOT_AUTHENTICATED', 'Authentication is required'));
    return;
  }

  const session = await getSession(prisma, token);
  if (!session) {
    next(new AppError(401, 'NOT_AUTHENTICATED', 'Authentication is required'));
    return;
  }

  req.userId = session.userId;
  req.sessionRecord = session;
  next();
}
