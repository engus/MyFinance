// apps/web/src/api/client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, setCsrfToken } from './client';

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends credentials and JSON content-type', async () => {
    await apiFetch('/auth/me');
    const [, options] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.credentials).toBe('include');
  });

  it('attaches the CSRF header on mutating requests once a token is set', async () => {
    setCsrfToken('token-123');
    await apiFetch('/auth/logout', { method: 'POST' });
    const [, options] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = options.headers as Headers;
    expect(headers.get('X-CSRF-Token')).toBe('token-123');
  });

  it('throws with the server error message on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        }),
      })
    );
    await expect(apiFetch('/auth/login', { method: 'POST' })).rejects.toThrow(
      'Invalid email or password'
    );
  });

  it('preserves validation fields from the common error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            fields: { amount: ['Required'] },
          },
        }),
      })
    );
    await expect(apiFetch('/transactions', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      fields: { amount: ['Required'] },
    });
  });
});
