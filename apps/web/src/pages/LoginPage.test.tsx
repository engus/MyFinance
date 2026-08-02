import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from '../router';
import * as authApi from '../api/auth';
import { LoginPage } from './LoginPage';

const user = {
  id: '1',
  email: 'a@b.com',
  displayCurrency: 'USD' as const,
  timezone: 'UTC',
  totpEnabled: false,
};

describe('LoginPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('authenticates a password-only user', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({ requiresTotp: false, user, csrfToken: 'csrf' });
    const onAuthenticated = vi.fn();
    render(
      <MemoryRouter>
        <LoginPage onAuthenticated={onAuthenticated} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'A@B.COM' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'strong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(user));
  });

  it('continues through a one-time 2FA challenge', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      requiresTotp: true,
      challengeToken: 'challenge',
    });
    vi.spyOn(authApi, 'verifyTwoFactor').mockResolvedValue(user);
    const onAuthenticated = vi.fn();
    render(
      <MemoryRouter>
        <LoginPage onAuthenticated={onAuthenticated} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'strong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const code = await screen.findByLabelText('Authentication or recovery code');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await waitFor(() =>
      expect(authApi.verifyTwoFactor).toHaveBeenCalledWith('challenge', '123456')
    );
  });
});
