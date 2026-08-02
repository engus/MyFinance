import { apiFetch } from './client';

export interface Entry {
  id: string;
  accountId: string | null;
  categoryId: string | null;
  amount: string;
  currency: string;
}

export interface Transaction {
  id: string;
  description: string;
  date: string;
  frequency: 'ONE_OFF' | 'RECURRING';
  interval: 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM' | null;
  isActive: boolean;
  templateAmount: string | null;
  templateCurrency: string | null;
  entries: Entry[];
}

export interface EntryInput {
  accountId?: string;
  categoryId?: string;
  amount: string;
  currency: string;
}

export interface CreateOneOffInput {
  description: string;
  date: string;
  entries: [EntryInput, EntryInput];
}

export interface CreateRecurringInput {
  description: string;
  accountId: string;
  categoryId: string;
  amount: string;
  currency: string;
  interval: 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM';
  customDays?: number;
  startDate: string;
}

export async function fetchTransactions(
  filters: { kind?: 'INCOME' | 'EXPENSE' } = {}
): Promise<Transaction[]> {
  const query = filters.kind ? `?kind=${filters.kind}` : '';
  return apiFetch(`/transactions${query}`);
}

export async function createOneOffTransaction(input: CreateOneOffInput): Promise<Transaction> {
  return apiFetch('/transactions', { method: 'POST', body: JSON.stringify(input) });
}

export async function createRecurringTransaction(input: CreateRecurringInput): Promise<Transaction> {
  return apiFetch('/transactions', { method: 'POST', body: JSON.stringify(input) });
}

export async function deleteTransaction(id: string): Promise<{ hardDeleted: boolean }> {
  return apiFetch(`/transactions/${id}`, { method: 'DELETE' });
}
