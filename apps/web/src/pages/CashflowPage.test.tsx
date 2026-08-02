import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CashflowPage } from './CashflowPage';
import * as accountsApi from '../api/accounts';
import * as categoriesApi from '../api/categories';
import * as transactionsApi from '../api/transactions';

describe('CashflowPage', () => {
  afterEach(() => cleanup());

  it('loads and renders accounts in the sidebar', async () => {
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([
      { id: '1', name: 'Card', kind: 'FINANCIAL', currency: 'USD', balance: '500' },
    ]);
    vi.spyOn(categoriesApi, 'fetchCategories').mockResolvedValue([]);
    vi.spyOn(transactionsApi, 'fetchTransactions').mockResolvedValue([]);

    render(
      <MemoryRouter>
        <CashflowPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Card')).toBeInTheDocument();
  });
});
