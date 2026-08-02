import { apiFetch } from './client';

export interface Category {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
  isSystem: boolean;
  isArchived: boolean;
}

export const fetchCategories = (includeArchived = false) =>
  apiFetch<Category[]>(`/categories${includeArchived ? '?includeArchived=true' : ''}`);
export const createCategory = (input: { name: string; kind: 'INCOME' | 'EXPENSE' }) =>
  apiFetch<Category>('/categories', { method: 'POST', body: JSON.stringify(input) });
export const updateCategory = (id: string, input: { name?: string; isArchived?: boolean }) =>
  apiFetch<Category>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
export const archiveCategory = (id: string) =>
  apiFetch<Category>(`/categories/${id}`, { method: 'DELETE' });
