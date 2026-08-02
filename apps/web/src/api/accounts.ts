import { CreateAccountInput, UpdateAccountInput } from '@myfinance/contracts';
import { apiFetch } from './client';

export interface Account {
  id: string;
  name: string;
  class: 'ASSET' | 'LIABILITY' | 'EQUITY';
  subtype: string;
  currency: string;
  balance: string;
  institution: string | null;
  countryCode: string | null;
  isArchived: boolean;
}

export const fetchAccounts = (includeArchived = false) =>
  apiFetch<Account[]>(`/accounts${includeArchived ? '?includeArchived=true' : ''}`);
export const createAccount = (input: CreateAccountInput) =>
  apiFetch<Account>('/accounts', { method: 'POST', body: JSON.stringify(input) });
export const updateAccount = (id: string, input: UpdateAccountInput) =>
  apiFetch<Account>(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
export const archiveAccount = (id: string) =>
  apiFetch<Account>(`/accounts/${id}`, { method: 'DELETE' });

export interface ReconciliationPreview {
  id: string;
  expectedBalance: string;
  statedBalance: string;
  delta: string;
  requiresConfirmation: boolean;
  applied?: boolean;
}

export const previewReconciliation = (
  accountId: string,
  input: { statedBalance: string; date: string; fxRate?: string }
) =>
  apiFetch<ReconciliationPreview>(`/accounts/${accountId}/reconciliations/preview`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const confirmReconciliation = (id: string, fxRate?: string) =>
  apiFetch<ReconciliationPreview>(`/accounts/reconciliations/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ fxRate }),
  });
