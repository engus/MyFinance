import crypto from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from './errors';

type Db = PrismaClient | Prisma.TransactionClient;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  prisma: Db,
  userId: string,
  metadata: { userAgent?: string; ipAddress?: string } = {}
) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({
    data: {
      id: hashOpaqueToken(token),
      userId,
      csrfToken,
      expiresAt,
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
    },
  });
  return { token, csrfToken, expiresAt, sessionId: session.id };
}

export async function getSession(prisma: PrismaClient, token: string) {
  const session = await prisma.session.findUnique({ where: { id: hashOpaqueToken(token) } });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > 15 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session;
}

export async function destroySession(prisma: Db, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: hashOpaqueToken(token) } });
}

export async function listSessions(prisma: PrismaClient, userId: string, currentToken: string) {
  const currentId = hashOpaqueToken(currentToken);
  const sessions = await prisma.session.findMany({
    where: { userId },
    orderBy: { lastSeenAt: 'desc' },
  });
  return sessions.map((session) => ({
    id: session.id,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    current: session.id === currentId,
  }));
}

export async function revokeSession(
  prisma: PrismaClient,
  userId: string,
  sessionId: string,
  currentToken: string
) {
  const session = await prisma.session.findFirst({ where: { id: sessionId, userId } });
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
  if (session.id === hashOpaqueToken(currentToken)) {
    throw new AppError(409, 'CURRENT_SESSION', 'Use logout to revoke the current session');
  }
  await prisma.session.delete({ where: { id: session.id } });
}

export async function cleanupExpiredAuthState(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.loginChallenge.deleteMany({ where: { expiresAt: { lte: now } } }),
  ]);
}
