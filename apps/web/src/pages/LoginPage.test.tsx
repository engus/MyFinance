import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { LoginPage } from './LoginPage';
import * as authApi from '../api/auth';

describe('LoginPage', () => {
  afterEach(() => cleanup());


  it('calls onSuccess after a successful login', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({ id: '1', email: 'a@b.com', csrfToken: 'x' });
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/пароль/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /войти/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('shows an error message on failed login', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(new Error('Invalid email or password'));
    render(<LoginPage onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/пароль/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /войти/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});
