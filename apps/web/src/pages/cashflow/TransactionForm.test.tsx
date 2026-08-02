import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TransactionForm } from './TransactionForm';
import * as transactionsApi from '../../api/transactions';

const accounts = [{ id: 'acc-1', name: 'Card', kind: 'FINANCIAL' as const, currency: 'USD', balance: '0' }];
const categories = [{ id: 'cat-1', name: 'Продукты', kind: 'EXPENSE' as const, isSystem: false }];

describe('TransactionForm', () => {
  afterEach(() => cleanup());

  it('submits a one-off expense with a negative signed amount on the account entry', async () => {
    vi.spyOn(transactionsApi, 'createOneOffTransaction').mockResolvedValue({} as never);
    const onDone = vi.fn();
    render(
      <TransactionForm
        kind="EXPENSE"
        accounts={accounts}
        categories={categories}
        onDone={onDone}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/описание/i), { target: { value: 'Продукты' } });
    fireEvent.change(screen.getByLabelText(/сумма/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /сохранить/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(transactionsApi.createOneOffTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          { accountId: 'acc-1', amount: '-50', currency: 'USD' },
          { categoryId: 'cat-1', amount: '50', currency: 'USD' },
        ],
      })
    );
  });

  it('submits a recurring transaction when the "Регулярная" toggle is checked', async () => {
    vi.spyOn(transactionsApi, 'createRecurringTransaction').mockResolvedValue({} as never);
    const onDone = vi.fn();
    render(
      <TransactionForm
        kind="EXPENSE"
        accounts={accounts}
        categories={categories}
        onDone={onDone}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/описание/i), { target: { value: 'Аренда' } });
    fireEvent.change(screen.getByLabelText(/сумма/i), { target: { value: '1000' } });
    fireEvent.click(screen.getByLabelText(/регулярная/i));
    fireEvent.click(screen.getByRole('button', { name: /сохранить/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(transactionsApi.createRecurringTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '-1000', interval: 'MONTH' })
    );
  });
});
