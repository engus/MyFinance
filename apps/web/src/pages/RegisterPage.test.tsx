import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from '../router';
import * as authApi from '../api/auth';
import { RegisterPage } from './RegisterPage';

describe('RegisterPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it('creates credentials before onboarding preferences', async () => {
    const user = {
      id: '1',
      email: 'a@b.com',
      displayCurrency: 'EUR' as const,
      timezone: 'UTC',
      totpEnabled: false,
    };
    vi.spyOn(authApi, 'register').mockResolvedValue(user);
    const onAuthenticated = vi.fn();
    render(
      <MemoryRouter>
        <RegisterPage onAuthenticated={onAuthenticated} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'password-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(authApi.register).toHaveBeenCalledWith(
        expect.objectContaining({ functionalCurrency: 'USD', timezone: 'UTC' })
      )
    );
    expect(onAuthenticated).toHaveBeenCalledWith(user);
  });
});
