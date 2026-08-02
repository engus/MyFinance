import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount, fetchAccounts, previewReconciliation } from './accounts';
import { fetchCategories } from './categories';
import { createOperation, fetchTransactions, reverseTransaction } from './transactions';

const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

describe('resource API clients', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ items: [], nextCursor: null }),
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads accounts and categories from their collection endpoints', async () => {
    await fetchAccounts();
    await fetchCategories();
    expect(fetchMock().mock.calls[0][0]).toBe('/api/accounts');
    expect(fetchMock().mock.calls[1][0]).toBe('/api/categories');
  });

  it('creates a typed asset account with an opening balance', async () => {
    const payload = {
      name: 'Checking',
      class: 'ASSET' as const,
      subtype: 'BANK' as const,
      currency: 'USD' as const,
      openingBalance: '1250.50',
      openingDate: '2026-08-01',
    };
    await createAccount(payload);
    const [url, options] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/accounts');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual(payload);
  });

  it('sends typed operations instead of arbitrary ledger entries', async () => {
    const operation = {
      type: 'EXPENSE' as const,
      date: '2026-08-01',
      description: 'Groceries',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      amount: '42.17',
      currency: 'USD' as const,
    };
    await createOperation(operation);
    const [url, options] = fetchMock().mock.calls[0];
    expect(url).toBe('/api/transactions');
    expect(JSON.parse(options.body)).toEqual(operation);
  });

  it('uses cursor filters and immutable reversal endpoints', async () => {
    await fetchTransactions({ type: 'EXPENSE', cursor: 'tx-10' });
    await reverseTransaction('tx-1');
    expect(fetchMock().mock.calls[0][0]).toBe('/api/transactions?type=EXPENSE&cursor=tx-10');
    expect(fetchMock().mock.calls[1][0]).toBe('/api/transactions/tx-1/reverse');
    expect(fetchMock().mock.calls[1][1].method).toBe('POST');
  });

  it('creates a reconciliation preview before confirmation', async () => {
    await previewReconciliation('acc-1', { statedBalance: '100.00', date: '2026-08-01' });
    expect(fetchMock().mock.calls[0][0]).toBe('/api/accounts/acc-1/reconciliations/preview');
  });
});
