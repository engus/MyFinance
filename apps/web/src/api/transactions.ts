import { CreateOperationInput, RecurrenceInput } from '@myfinance/contracts';
import { apiFetch } from './client';

export interface TransactionEntry {
  id: string;
  accountId: string | null;
  categoryId: string | null;
  originalAmount: string;
  originalCurrency: string;
  functionalAmount: string;
  fxRate: string;
  rateSource: string;
  account: { name: string; class: string } | null;
  category: { name: string; kind: string } | null;
}

export interface Transaction {
  id: string;
  type: CreateOperationInput['type'] | 'VALUATION' | 'REVERSAL';
  status: 'POSTED' | 'REVERSED';
  description: string;
  occurredOn: string;
  entries: TransactionEntry[];
  reversedBy: { id: string } | null;
}

export interface TransactionPage {
  items: Transaction[];
  nextCursor: string | null;
}

export async function fetchTransactions(filters: Record<string, string | undefined> = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => value && query.set(key, value));
  return apiFetch<TransactionPage>(`/transactions${query.size ? `?${query}` : ''}`);
}
export const createOperation = (input: CreateOperationInput) =>
  apiFetch<Transaction>('/transactions', { method: 'POST', body: JSON.stringify(input) });
export const reverseTransaction = (id: string) =>
  apiFetch<Transaction>(`/transactions/${id}/reverse`, { method: 'POST', body: '{}' });
export const replaceTransaction = (id: string, input: CreateOperationInput) =>
  apiFetch<Transaction>(`/transactions/${id}/replace`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export interface RecurringTemplate {
  id: string;
  type: string;
  description: string;
  interval: string;
  customDays: number | null;
  nextRunDate: string;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}

export const fetchRecurring = () => apiFetch<RecurringTemplate[]>('/recurring');
export const createRecurring = (input: RecurrenceInput) =>
  apiFetch<RecurringTemplate>('/recurring', { method: 'POST', body: JSON.stringify(input) });
export const updateRecurring = (id: string, input: { status?: string; nextRunDate?: string }) =>
  apiFetch<RecurringTemplate>(`/recurring/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
