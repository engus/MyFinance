import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { RateService } from '../src/modules/rates/rates.service';
import { testPrisma, truncateAll } from './helpers/db';

describe('rates and HTTP boundary', () => {
  beforeEach(truncateAll);
  afterAll(() => testPrisma.$disconnect());

  it('prefers a same-date manual FX rate and can fall back to cached data', async () => {
    const provider = { getRate: vi.fn().mockResolvedValue('0.90') };
    const service = new RateService(testPrisma, provider);
    const day = new Date('2026-08-01T00:00:00Z');
    await service.resolve('USD', 'EUR', day, '0.91');
    expect((await service.resolve('USD', 'EUR', day)).rate.toString()).toBe('0.91');
    expect(provider.getRate).not.toHaveBeenCalled();
    await testPrisma.exchangeRate.deleteMany();
    expect((await service.resolve('USD', 'EUR', day)).rate.toString()).toBe('0.9');
    provider.getRate.mockRejectedValue(new Error('offline'));
    expect(
      (await service.resolve('USD', 'EUR', new Date('2026-08-02T00:00:00Z'))).rate.toString()
    ).toBe('0.9');
  });

  it('does not expose a user manual rate to another user', async () => {
    const provider = { getRate: vi.fn().mockRejectedValue(new Error('offline')) };
    const service = new RateService(testPrisma, provider);
    const day = new Date('2026-08-01T00:00:00Z');
    await service.resolve('EUR', 'USD', day, '1.2', 'user-a');
    expect((await service.resolve('EUR', 'USD', day, undefined, 'user-a')).rate.toString()).toBe(
      '1.2'
    );
    await expect(service.resolve('EUR', 'USD', day, undefined, 'user-b')).rejects.toMatchObject({
      code: 'RATE_REQUIRED',
    });
  });

  it('exposes health/readiness, security headers and one error envelope', async () => {
    const app = createApp(testPrisma);
    const health = await request(app).get('/health').expect(200);
    expect(health.body).toEqual({ status: 'ok' });
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-request-id']).toBeTruthy();
    await request(app).get('/ready').expect(200, { status: 'ready' });
    const invalid = await request(app)
      .post('/api/auth/register')
      .send({ email: 'broken' })
      .expect(400);
    expect(invalid.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(invalid.body.error.fields).toBeTruthy();
    const unauthenticated = await request(app).get('/api/accounts').expect(401);
    expect(unauthenticated.body).toEqual({
      error: { code: 'NOT_AUTHENTICATED', message: 'Authentication is required' },
    });
    await request(app)
      .get('/does-not-exist')
      .expect(404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
});
