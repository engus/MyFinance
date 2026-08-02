import argon2 from 'argon2';
import { Prisma, PrismaClient } from '@prisma/client';
import { UserSettingsInput } from '@myfinance/contracts';
import { AppError } from '../../lib/errors';
import { hashOpaqueToken } from '../../lib/session';
import { decryptSecret, verifyTotp } from '../auth/totp.service';

export async function getSettings(prisma: PrismaClient, userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      functionalCurrency: true,
      displayCurrency: true,
      timezone: true,
      reconciliationMode: true,
      totpEnabled: true,
      createdAt: true,
    },
  });
}

export async function updateSettings(
  prisma: PrismaClient,
  userId: string,
  input: UserSettingsInput
) {
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format();
    } catch {
      throw new AppError(400, 'INVALID_TIMEZONE', 'Unknown timezone');
    }
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  if (input.functionalCurrency && input.functionalCurrency !== user.functionalCurrency) {
    const posted = await prisma.transaction.count({ where: { userId } });
    if (posted > 0) {
      throw new AppError(
        409,
        'FUNCTIONAL_CURRENCY_LOCKED',
        'Functional currency cannot change after the first posting'
      );
    }
    return prisma.$transaction(async (tx) => {
      await tx.account.updateMany({
        where: { userId, isSystem: true, class: 'EQUITY' },
        data: { currency: input.functionalCurrency },
      });
      return tx.user.update({
        where: { id: userId },
        data: {
          ...input,
          displayCurrency:
            input.displayCurrency ??
            (user.displayCurrency === user.functionalCurrency
              ? input.functionalCurrency
              : user.displayCurrency),
        },
      });
    });
  }
  return prisma.user.update({ where: { id: userId }, data: input });
}

async function verifySensitiveAction(
  prisma: PrismaClient,
  userId: string,
  password: string,
  totpCode?: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await argon2.verify(user.passwordHash, password))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid password');
  }
  if (user.totpEnabled) {
    if (
      !totpCode ||
      !user.totpSecretEncrypted ||
      !verifyTotp(decryptSecret(user.totpSecretEncrypted), totpCode)
    ) {
      throw new AppError(401, 'INVALID_TOTP', 'A valid authentication code is required');
    }
  }
  return user;
}

export async function updateCredentials(
  prisma: PrismaClient,
  userId: string,
  currentSessionToken: string,
  input: { currentPassword: string; newEmail?: string; newPassword?: string; totpCode?: string }
) {
  await verifySensitiveAction(prisma, userId, input.currentPassword, input.totpCode);
  const data: Prisma.UserUpdateInput = {};
  if (input.newEmail) data.email = input.newEmail.trim().toLowerCase();
  if (input.newPassword)
    data.passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data });
      await tx.session.deleteMany({
        where: { userId, id: { not: hashOpaqueToken(currentSessionToken) } },
      });
      return user;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'EMAIL_EXISTS', 'Email is already registered');
    }
    throw error;
  }
}

export async function deleteUserAccount(
  prisma: PrismaClient,
  userId: string,
  password: string,
  totpCode?: string
) {
  await verifySensitiveAction(prisma, userId, password, totpCode);
  await prisma.$transaction(async (tx) => {
    await tx.recurringOccurrence.deleteMany({ where: { template: { userId } } });
    await tx.reconciliation.deleteMany({ where: { userId } });
    await tx.assetValuation.deleteMany({ where: { asset: { userId } } });
    await tx.transaction.deleteMany({ where: { userId } });
    await tx.recurringTemplate.deleteMany({ where: { userId } });
    await tx.assetProfile.deleteMany({ where: { userId } });
    await tx.exchangeRate.deleteMany({ where: { ownerKey: userId } });
    await tx.user.delete({ where: { id: userId } });
  });
}
