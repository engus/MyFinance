import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TransactionColumn } from './TransactionColumn';
import * as transactionsApi from '../../api/transactions';

const accounts = [{ id: 'acc-1', name: 'Card', kind: 'FINANCIAL' as const, currency: 'USD', balance: '0' }];
const categories = [{ id: 'cat-1', name: 'Продукты', kind: 'EXPENSE' as const, isSystem: false }];
const transactions = [
  {
    id: 'tx-1',
    description: 'Продукты',
    date: '2026-07-01',
    frequency: 'ONE_OFF' as const,
    interval: null,
    isActive: true,
    templateAmount: null,
    templateCurrency: null,
    entries: [
      { id: 'e1', accountId: 'acc-1', categoryId: null, amount: '-50.00', currency: 'USD' },
      { id: 'e2', accountId: null, categoryId: 'cat-1', amount: '50.00', currency: 'USD' },
    ],
  },
];

describe('TransactionColumn', () => {
  afterEach(() => cleanup());

  it('renders a transaction row', () => {
    render(
      <TransactionColumn
        title="Expense"
        kind="EXPENSE"
        transactions={transactions}
        accounts={accounts}
        categories={categories}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText('Продукты')).toBeInTheDocument();
  });

  it('deletes a transaction and calls onChanged', async () => {
    vi.spyOn(transactionsApi, 'deleteTransaction').mockResolvedValue({ hardDeleted: true });
    const onChanged = vi.fn();
    render(
      <TransactionColumn
        title="Expense"
        kind="EXPENSE"
        transactions={transactions}
        accounts={accounts}
        categories={categories}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /удалить/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(transactionsApi.deleteTransaction).toHaveBeenCalledWith('tx-1');
  });

  it('shows a visible error when deleting fails', async () => {
    vi.spyOn(transactionsApi, 'deleteTransaction').mockRejectedValue(new Error('Invalid CSRF token'));
    const onChanged = vi.fn();
    render(
      <TransactionColumn
        title="Expense"
        kind="EXPENSE"
        transactions={transactions}
        accounts={accounts}
        categories={categories}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /удалить/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid CSRF token');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows the add-transaction form when "+ Добавить" is clicked', () => {
    render(
      <TransactionColumn
        title="Expense"
        kind="EXPENSE"
        transactions={[]}
        accounts={accounts}
        categories={categories}
        onChanged={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /добавить/i }));

    expect(screen.getByLabelText(/описание/i)).toBeInTheDocument();
  });
});
