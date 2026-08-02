import crypto from 'node:crypto';
import argon2 from 'argon2';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { createSession, hashOpaqueToken } from '../../lib/session';
import { seedCategories } from '../categories/categories.service';
import {
  buildOtpAuthUri,
  createRecoveryCodes,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from './totp.service';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
let dummyHashPromise: Promise<string> | null = null;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function dummyHash() {
  dummyHashPromise ??= argon2.hash('constant-timing-dummy-password', { type: argon2.argon2id });
  return dummyHashPromise;
}

export interface AuthMetadata {
  userAgent?: string;
  ipAddress?: string;
}

export async function registerUser(
  prisma: PrismaClient,
  input: { email: string; password: string; functionalCurrency?: string; timezone?: string },
  metadata: AuthMetadata = {}
) {
  const email = normalizeEmail(input.email);
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          functionalCurrency: input.functionalCurrency ?? 'USD',
          displayCurrency: input.functionalCurrency ?? 'USD',
          timezone: input.timezone ?? 'UTC',
        },
      });
      await tx.account.create({
        data: {
          userId: user.id,
          name: 'Opening balance equity',
          class: 'EQUITY',
          subtype: 'OTHER',
          currency: user.functionalCurrency,
          isSystem: true,
        },
      });
      await seedCategories(tx, user.id);
      const session = await createSession(tx, user.id, metadata);
      return { user, session };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'EMAIL_EXISTS', 'Email is already registered');
    }
    throw error;
  }
}

export async function beginLogin(
  prisma: PrismaClient,
  emailInput: string,
  password: string,
  metadata: AuthMetadata = {}
) {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(emailInput) } });
  if (!user) {
    await argon2.verify(await dummyHash(), password);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  if (!(await argon2.verify(user.passwordHash, password))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  if (!user.totpEnabled) {
    return {
      requiresTotp: false as const,
      user,
      session: await createSession(prisma, user.id, metadata),
    };
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.loginChallenge.create({
    data: {
      id: hashOpaqueToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return { requiresTotp: true as const, challengeToken: token };
}

export async function completeLogin(
  prisma: PrismaClient,
  challengeToken: string,
  code: string,
  metadata: AuthMetadata = {}
) {
  const result = await prisma.$transaction(async (tx) => {
    const challenge = await tx.loginChallenge.findUnique({
      where: { id: hashOpaqueToken(challengeToken) },
      include: { user: true },
    });
    if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= 5) {
      throw new AppError(401, 'INVALID_CHALLENGE', 'The login challenge is invalid or expired');
    }
    const user = challenge.user;
    let valid = false;
    if (user.totpSecretEncrypted && /^\d{6}$/.test(code)) {
      valid = verifyTotp(decryptSecret(user.totpSecretEncrypted), code);
    } else {
      const recoveryHash = hashRecoveryCode(code);
      const recovery = await tx.recoveryCode.findFirst({
        where: { userId: user.id, codeHash: recoveryHash, usedAt: null },
      });
      if (recovery) {
        valid = true;
        await tx.recoveryCode.update({ where: { id: recovery.id }, data: { usedAt: new Date() } });
      }
    }
    if (!valid) {
      await tx.loginChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      return { valid: false as const };
    }
    await tx.loginChallenge.delete({ where: { id: challenge.id } });
    return { valid: true as const, user, session: await createSession(tx, user.id, metadata) };
  });
  if (!result.valid) throw new AppError(401, 'INVALID_TOTP', 'Invalid authentication code');
  return result;
}

export async function beginTotpSetup(prisma: PrismaClient, userId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    if (user.totpEnabled)
      throw new AppError(
        409,
        'TOTP_ALREADY_ENABLED',
        'Two-factor authentication is already enabled'
      );
    const secret = user.totpSecretEncrypted
      ? decryptSecret(user.totpSecretEncrypted)
      : generateTotpSecret();
    if (!user.totpSecretEncrypted) {
      await tx.user.update({
        where: { id: userId },
        data: { totpSecretEncrypted: encryptSecret(secret) },
      });
    }
    return { secret, otpAuthUri: buildOtpAuthUri(user.email, secret) };
  });
}

export async function confirmTotpSetup(prisma: PrismaClient, userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpSecretEncrypted || !verifyTotp(decryptSecret(user.totpSecretEncrypted), code)) {
    throw new AppError(400, 'INVALID_TOTP', 'Invalid authentication code');
  }
  const codes = createRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.recoveryCode.createMany({
      data: codes.map((value) => ({ userId, codeHash: hashRecoveryCode(value) })),
    });
  });
  return { recoveryCodes: codes };
}

export async function disableTotp(
  prisma: PrismaClient,
  userId: string,
  password: string,
  code: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await argon2.verify(user.passwordHash, password))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid password');
  }
  if (!user.totpSecretEncrypted || !verifyTotp(decryptSecret(user.totpSecretEncrypted), code)) {
    throw new AppError(401, 'INVALID_TOTP', 'Invalid authentication code');
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecretEncrypted: null },
    }),
    prisma.recoveryCode.deleteMany({ where: { userId } }),
  ]);
}
