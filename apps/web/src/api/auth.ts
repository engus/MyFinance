import { apiFetch, setCsrfToken } from './client';

interface AuthResponse {
  id: string;
  email: string;
  csrfToken: string;
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  const data = (await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })) as AuthResponse;
  setCsrfToken(data.csrfToken);
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = (await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })) as AuthResponse;
  setCsrfToken(data.csrfToken);
  return data;
}

export async function fetchCurrentUser(): Promise<{ id: string; email: string }> {
  return apiFetch('/auth/me', { method: 'GET' });
}
