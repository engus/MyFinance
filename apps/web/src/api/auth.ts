import { Currency } from '@myfinance/contracts';
import { apiFetch, setCsrfToken } from './client';

export interface CurrentUser {
  id: string;
  email: string;
  displayCurrency: Currency;
  timezone: string;
  totpEnabled: boolean;
}

interface SessionResponse {
  user: CurrentUser;
  csrfToken: string;
}

export async function register(input: {
  email: string;
  password: string;
  functionalCurrency: Currency;
  timezone: string;
}): Promise<CurrentUser> {
  const response = await apiFetch<SessionResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  setCsrfToken(response.csrfToken);
  return response.user;
}

export async function login(email: string, password: string) {
  const response = await apiFetch<
    { requiresTotp: true; challengeToken: string } | ({ requiresTotp: false } & SessionResponse)
  >('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!response.requiresTotp) setCsrfToken(response.csrfToken);
  return response;
}

export async function verifyTwoFactor(challengeToken: string, code: string): Promise<CurrentUser> {
  const response = await apiFetch<SessionResponse>('/auth/verify-2fa', {
    method: 'POST',
    body: JSON.stringify({ challengeToken, code }),
  });
  setCsrfToken(response.csrfToken);
  return response.user;
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  const response = await apiFetch<SessionResponse>('/auth/me');
  setCsrfToken(response.csrfToken);
  return response.user;
}

export async function logout(): Promise<void> {
  await apiFetch<void>('/auth/logout', { method: 'POST' });
  setCsrfToken(null);
}
