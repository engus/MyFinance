import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AccountsSidebar } from './AccountsSidebar';
import * as accountsApi from '../../api/accounts';

describe('AccountsSidebar', () => {
  afterEach(() => cleanup());

  it('renders each account name and balance', () => {
    render(
      <AccountsSidebar
        accounts={[{ id: '1', name: 'Card', kind: 'FINANCIAL', currency: 'USD', balance: '500' }]}
        onReconciled={vi.fn()}
      />
    );

    expect(screen.getByText('Card')).toBeInTheDocument();
    expect(screen.getByText('500 USD')).toBeInTheDocument();
  });

  it('opens the reconcile form and submits a new balance', async () => {
    vi.spyOn(accountsApi, 'reconcileAccount').mockResolvedValue({
      delta: '50',
      applied: true,
      generatedOccurrences: [],
    });
    const onReconciled = vi.fn();
    render(
      <AccountsSidebar
        accounts={[{ id: '1', name: 'Card', kind: 'FINANCIAL', currency: 'USD', balance: '500' }]}
        onReconciled={onReconciled}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /сверить/i }));
    fireEvent.change(screen.getByLabelText(/новый остаток/i), { target: { value: '550' } });
    fireEvent.click(screen.getByRole('button', { name: /сохранить/i }));

    await waitFor(() => expect(onReconciled).toHaveBeenCalled());
    expect(accountsApi.reconcileAccount).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ newBalance: '550' })
    );
  });

  it('shows a visible error when reconciling fails', async () => {
    vi.spyOn(accountsApi, 'reconcileAccount').mockRejectedValue(new Error('Invalid CSRF token'));
    const onReconciled = vi.fn();
    render(
      <AccountsSidebar
        accounts={[{ id: '1', name: 'Card', kind: 'FINANCIAL', currency: 'USD', balance: '500' }]}
        onReconciled={onReconciled}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /сверить/i }));
    fireEvent.change(screen.getByLabelText(/новый остаток/i), { target: { value: '550' } });
    fireEvent.click(screen.getByRole('button', { name: /сохранить/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid CSRF token');
    expect(onReconciled).not.toHaveBeenCalled();
  });
});
