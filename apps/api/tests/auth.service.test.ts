import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, truncateAll } from './helpers/db';
import {
  registerUser,
  loginUser,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from '../src/modules/auth/auth.service';

describe('auth.service', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('registers a user, hashes the password, and seeds system categories', async () => {
    const { user, session } = await registerUser(testPrisma, 'a@b.com', 'password123');

    expect(user.email).toBe('a@b.com');
    expect(user.passwordHash).not.toBe('password123');
    expect(session.token).toBeTruthy();

    const categories = await testPrisma.category.findMany({ where: { userId: user.id } });
    expect(categories).toHaveLength(2);
  });

  it('rejects registering the same email twice', async () => {
    await registerUser(testPrisma, 'a@b.com', 'password123');
    await expect(registerUser(testPrisma, 'a@b.com', 'other-password')).rejects.toThrow(
      EmailAlreadyRegisteredError
    );
  });

  it('logs in with correct credentials', async () => {
    await registerUser(testPrisma, 'a@b.com', 'password123');
    const { user, session } = await loginUser(testPrisma, 'a@b.com', 'password123');
    expect(user.email).toBe('a@b.com');
    expect(session.token).toBeTruthy();
  });

  it('rejects login with a wrong password', async () => {
    await registerUser(testPrisma, 'a@b.com', 'password123');
    await expect(loginUser(testPrisma, 'a@b.com', 'wrong-password')).rejects.toThrow(
      InvalidCredentialsError
    );
  });

  it('rejects login for an unknown email', async () => {
    await expect(loginUser(testPrisma, 'nobody@b.com', 'password123')).rejects.toThrow(
      InvalidCredentialsError
    );
  });

  it('takes comparable time for unknown-email and wrong-password rejections (timing side-channel)', async () => {
    await registerUser(testPrisma, 'a@b.com', 'password123');

    const start1 = performance.now();
    await expect(loginUser(testPrisma, 'a@b.com', 'wrong-password')).rejects.toThrow(
      InvalidCredentialsError
    );
    const wrongPasswordDuration = performance.now() - start1;

    const start2 = performance.now();
    await expect(loginUser(testPrisma, 'nobody@b.com', 'wrong-password')).rejects.toThrow(
      InvalidCredentialsError
    );
    const unknownEmailDuration = performance.now() - start2;

    // Both branches perform an argon2 verify, so neither should be a near-instant
    // short-circuit, and the unknown-email path shouldn't be wildly faster than the
    // wrong-password path (which would reveal that emails can be enumerated by timing).
    // A generous 50% floor and order-of-magnitude ceiling avoid CI/DB jitter flakiness.
    expect(unknownEmailDuration).toBeGreaterThanOrEqual(wrongPasswordDuration * 0.5);
    expect(unknownEmailDuration).toBeLessThanOrEqual(wrongPasswordDuration * 5);
  });
});
