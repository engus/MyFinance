import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { RegisterPage } from './RegisterPage';
import * as authApi from '../api/auth';

describe('RegisterPage', () => {
  afterEach(() => cleanup());

  it('calls onSuccess after a successful registration', async () => {
    vi.spyOn(authApi, 'register').mockResolvedValue({ id: '1', email: 'a@b.com', csrfToken: 'x' });
    const onSuccess = vi.fn();
    render(<RegisterPage onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/пароль/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /зарегистрироваться/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('shows an error message when the email is already registered', async () => {
    vi.spyOn(authApi, 'register').mockRejectedValue(new Error('Email already registered'));
    render(<RegisterPage onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/пароль/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /зарегистрироваться/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered');
  });
});
