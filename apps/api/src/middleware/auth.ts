import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { getSession } from '../lib/session';

export function requireAuth(prisma: PrismaClient) {
  return (req: Request, res: Response, next: NextFunction) => {
    handleAuth(prisma, req, res, next).catch(next);
  };
}

async function handleAuth(
  prisma: PrismaClient,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const token = req.cookies?.sid as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const session = await getSession(prisma, token);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  req.userId = session.userId;
  req.sessionRecord = session;
  next();
}
