import { apiFetch } from './client';

export interface Category {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
  isSystem: boolean;
}

export async function fetchCategories(): Promise<Category[]> {
  return apiFetch('/categories');
}

export async function createCategory(input: {
  name: string;
  kind: 'INCOME' | 'EXPENSE';
}): Promise<Category> {
  return apiFetch('/categories', { method: 'POST', body: JSON.stringify(input) });
}
