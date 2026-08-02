import { apiFetch } from './client';

export interface Account {
  id: string;
  name: string;
  kind: 'FINANCIAL' | 'ASSET';
  currency: string;
  balance: string;
}

export async function fetchAccounts(): Promise<Account[]> {
  return apiFetch('/accounts');
}

export async function createAccount(input: {
  name: string;
  kind: 'FINANCIAL' | 'ASSET';
  currency: string;
}): Promise<Account> {
  return apiFetch('/accounts', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateAccount(
  id: string,
  input: { name?: string; currency?: string }
): Promise<Account> {
  return apiFetch(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function deleteAccount(id: string): Promise<{ hardDeleted: boolean }> {
  return apiFetch(`/accounts/${id}`, { method: 'DELETE' });
}

export async function reconcileAccount(
  accountId: string,
  input: { newBalance: string; date: string }
): Promise<{ delta: string; applied: boolean; generatedOccurrences: string[] }> {
  return apiFetch(`/accounts/${accountId}/reconcile`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
