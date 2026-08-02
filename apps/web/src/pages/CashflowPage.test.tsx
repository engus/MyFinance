import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as accountsApi from '../api/accounts';
import * as categoriesApi from '../api/categories';
import * as transactionsApi from '../api/transactions';
import { CashflowPage } from './CashflowPage';

describe('CashflowPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it('shows the ledger account and an empty transaction state', async () => {
    vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([
      {
        id: '1',
        name: 'Checking',
        class: 'ASSET',
        subtype: 'BANK',
        currency: 'USD',
        balance: '500.00000000',
        institution: null,
        countryCode: null,
        isArchived: false,
      },
    ]);
    vi.spyOn(categoriesApi, 'fetchCategories').mockResolvedValue([]);
    vi.spyOn(transactionsApi, 'fetchTransactions').mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    vi.spyOn(transactionsApi, 'fetchRecurring').mockResolvedValue([]);
    render(<CashflowPage />);
    expect((await screen.findAllByText('Checking')).length).toBeGreaterThan(0);
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
  });
});
