import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAccounts, createAccount, reconcileAccount } from './accounts';
import { fetchCategories } from './categories';
import { fetchTransactions, createOneOffTransaction, deleteTransaction } from './transactions';

function fetchMock() {
  return fetch as unknown as ReturnType<typeof vi.fn>;
}

describe('resource API clients', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchAccounts hits GET /api/accounts', async () => {
    await fetchAccounts();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/accounts');
  });

  it('createAccount posts to /api/accounts with the given payload', async () => {
    await createAccount({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });
    const [url, options] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/accounts');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ name: 'Card', kind: 'FINANCIAL', currency: 'USD' });
  });

  it('reconcileAccount posts to /api/accounts/:id/reconcile', async () => {
    await reconcileAccount('acc-1', { newBalance: '100', date: '2026-08-01' });
    const [url] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/accounts/acc-1/reconcile');
  });

  it('fetchCategories hits GET /api/categories', async () => {
    await fetchCategories();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/categories');
  });

  it('fetchTransactions appends the kind filter as a query param', async () => {
    await fetchTransactions({ kind: 'EXPENSE' });
    const [url] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/transactions?kind=EXPENSE');
  });

  it('fetchTransactions omits the query string when no filter is given', async () => {
    await fetchTransactions();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/transactions');
  });

  it('createOneOffTransaction posts entries to /api/transactions', async () => {
    await createOneOffTransaction({
      description: 'Salary',
      date: '2026-08-01',
      entries: [
        { accountId: 'acc-1', amount: '1000.00', currency: 'USD' },
        { categoryId: 'cat-1', amount: '-1000.00', currency: 'USD' },
      ],
    });
    const [url, options] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/transactions');
    expect(options.method).toBe('POST');
  });

  it('deleteTransaction sends DELETE to /api/transactions/:id', async () => {
    await deleteTransaction('tx-1');
    const [url, options] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/transactions/tx-1');
    expect(options.method).toBe('DELETE');
  });
});
