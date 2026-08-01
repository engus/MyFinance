import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { createSession } from '../../lib/session';
import { seedSystemCategories } from '../categories/categories.service';

export class EmailAlreadyRegisteredError extends Error {}
export class InvalidCredentialsError extends Error {}

let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash('dummy-password-for-timing-safety', { type: argon2.argon2id });
  }
  return dummyHashPromise;
}

export async function registerUser(prisma: PrismaClient, email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new EmailAlreadyRegisteredError();

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.create({ data: { email, passwordHash } });
  await seedSystemCategories(prisma, user.id);
  const session = await createSession(prisma, user.id);

  return { user, session };
}

export async function loginUser(prisma: PrismaClient, email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await argon2.verify(await getDummyHash(), password);
    throw new InvalidCredentialsError();
  }

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) throw new InvalidCredentialsError();

  const session = await createSession(prisma, user.id);
  return { user, session };
}
