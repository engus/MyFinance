import { Currency, ManualRateInput } from '@myfinance/contracts';
import { apiFetch } from './client';

export interface Settings {
  id: string;
  email: string;
  functionalCurrency: Currency;
  displayCurrency: Currency;
  timezone: string;
  reconciliationMode: 'AUTO' | 'CONFIRM';
  totpEnabled: boolean;
}
export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export const fetchSettings = () => apiFetch<Settings>('/settings');
export const updateSettings = (
  input: Partial<
    Pick<Settings, 'functionalCurrency' | 'displayCurrency' | 'timezone' | 'reconciliationMode'>
  >
) => apiFetch<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(input) });
export const saveManualRate = (input: ManualRateInput) =>
  apiFetch<{ rate: string; source: string }>('/settings/rates', {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const updateCredentials = (input: {
  currentPassword: string;
  newEmail?: string;
  newPassword?: string;
  totpCode?: string;
}) => apiFetch('/settings/credentials', { method: 'PUT', body: JSON.stringify(input) });
export const deleteAccount = (password: string, totpCode?: string) =>
  apiFetch<void>('/settings/account', {
    method: 'DELETE',
    body: JSON.stringify({ password, totpCode }),
  });
export const fetchSessions = () => apiFetch<SessionInfo[]>('/settings/sessions');
export const revokeSession = (id: string) =>
  apiFetch<void>(`/settings/sessions/${id}`, { method: 'DELETE' });
export const setupTwoFactor = () =>
  apiFetch<{ secret: string; otpAuthUri: string }>('/settings/2fa/setup', {
    method: 'POST',
    body: '{}',
  });
export const confirmTwoFactor = (code: string) =>
  apiFetch<{ recoveryCodes: string[] }>('/settings/2fa/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
export const disableTwoFactor = (password: string, code: string) =>
  apiFetch<void>('/settings/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  });
