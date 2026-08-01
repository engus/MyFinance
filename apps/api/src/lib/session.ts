import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  prisma: PrismaClient,
  userId: string
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: { id: hashToken(token), userId, csrfToken, expiresAt },
  });

  return { token, csrfToken, expiresAt };
}

export async function getSession(prisma: PrismaClient, token: string) {
  const session = await prisma.session.findUnique({ where: { id: hashToken(token) } });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

export async function destroySession(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}
