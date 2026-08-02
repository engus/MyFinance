import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import {
  beginLogin,
  beginTotpSetup,
  completeLogin,
  registerUser,
} from '../src/modules/auth/auth.service';
import {
  buildOtpAuthUri,
  createRecoveryCodes,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from '../src/modules/auth/totp.service';
import { testPrisma, truncateAll } from './helpers/db';

describe('authentication hardening', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('normalizes email and atomically creates session and system data', async () => {
    const result = await registerUser(testPrisma, {
      email: '  OWNER@Example.COM ',
      password: 'long-test-password',
      functionalCurrency: 'EUR',
      timezone: 'Europe/Paris',
    });
    expect(result.user.email).toBe('owner@example.com');
    expect(result.user.functionalCurrency).toBe('EUR');
    expect(
      await testPrisma.category.count({ where: { userId: result.user.id, isSystem: true } })
    ).toBe(6);
    expect(
      await testPrisma.account.count({
        where: { userId: result.user.id, class: 'EQUITY', isSystem: true },
      })
    ).toBe(1);
    expect(await argon2.verify(result.user.passwordHash, 'long-test-password')).toBe(true);
    expect(await testPrisma.session.count({ where: { userId: result.user.id } })).toBe(1);
  });

  it('returns the same public error for unknown users and wrong passwords', async () => {
    await registerUser(testPrisma, { email: 'owner@example.com', password: 'long-test-password' });
    await expect(beginLogin(testPrisma, 'owner@example.com', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await expect(beginLogin(testPrisma, 'missing@example.com', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('encrypts TOTP secrets and creates non-reversible recovery hashes', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
    expect(verifyTotp(secret, '123')).toBe(false);
    expect(buildOtpAuthUri('owner@example.com', secret)).toContain('issuer=MyFinance');
    const codes = createRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(hashRecoveryCode(codes[0]!)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRecoveryCode(codes[0]!)).not.toContain(codes[0]!);
  });

  it('keeps an unconfirmed TOTP setup stable across repeated requests', async () => {
    const result = await registerUser(testPrisma, {
      email: 'setup@example.com',
      password: 'long-test-password',
    });
    const [first, second] = await Promise.all([
      beginTotpSetup(testPrisma, result.user.id),
      beginTotpSetup(testPrisma, result.user.id),
    ]);
    expect(second.secret).toBe(first.secret);
    expect(second.otpAuthUri).toBe(first.otpAuthUri);
  });

  it('persists failed challenge attempts instead of rolling them back', async () => {
    const result = await registerUser(testPrisma, {
      email: 'totp@example.com',
      password: 'long-test-password',
    });
    await testPrisma.user.update({
      where: { id: result.user.id },
      data: { totpEnabled: true, totpSecretEncrypted: encryptSecret(generateTotpSecret()) },
    });
    const challenge = await beginLogin(testPrisma, 'totp@example.com', 'long-test-password');
    expect(challenge.requiresTotp).toBe(true);
    if (!challenge.requiresTotp) throw new Error('Expected a TOTP challenge');
    await expect(
      completeLogin(testPrisma, challenge.challengeToken, 'NOT-A-RECOVERY-CODE')
    ).rejects.toMatchObject({ code: 'INVALID_TOTP' });
    const stored = await testPrisma.loginChallenge.findUniqueOrThrow({
      where: { id: (await import('../src/lib/session')).hashOpaqueToken(challenge.challengeToken) },
    });
    expect(stored.attempts).toBe(1);
  });
});
