import { useCallback, useEffect, useState } from 'react';
import { Account, archiveAccount, fetchAccounts } from '../api/accounts';
import { archiveCategory, Category, createCategory, fetchCategories } from '../api/categories';
import {
  fetchRecurring,
  fetchTransactions,
  RecurringTemplate,
  reverseTransaction,
  Transaction,
  updateRecurring,
} from '../api/transactions';
import { EmptyState, ErrorBanner, Skeleton } from '../components/AsyncState';
import { Money } from '../components/Money';
import { Modal } from '../components/Modal';
import { AccountForm } from './cashflow/AccountForm';
import { OperationForm } from './cashflow/OperationForm';
import { ReconcileForm } from './cashflow/ReconcileForm';

type ModalState = 'operation' | 'account' | 'categories' | null;
const CORRECTABLE_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER', 'LIABILITY_PAYMENT'];

export function CashflowPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recurring, setRecurring] = useState<RecurringTemplate[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [reconcile, setReconcile] = useState<Account | null>(null);
  const [replacementId, setReplacementId] = useState<string>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [accountFilter, setAccountFilter] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [accountRows, categoryRows, page, schedules] = await Promise.all([
        fetchAccounts(),
        fetchCategories(),
        fetchTransactions({
          from: from || undefined,
          to: to || undefined,
          accountId: accountFilter || undefined,
        }),
        fetchRecurring(),
      ]);
      setAccounts(accountRows);
      setCategories(categoryRows);
      setTransactions(page.items);
      setNextCursor(page.nextCursor);
      setRecurring(schedules);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load cashflow');
    } finally {
      setLoading(false);
    }
  }, [from, to, accountFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    const page = await fetchTransactions({
      from: from || undefined,
      to: to || undefined,
      accountId: accountFilter || undefined,
      cursor: nextCursor,
    });
    setTransactions((rows) => [...rows, ...page.items]);
    setNextCursor(page.nextCursor);
  }

  async function reverse(row: Transaction) {
    if (!window.confirm(`Reverse “${row.description}”? The audit trail will be preserved.`)) return;
    try {
      await reverseTransaction(row.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reverse operation');
    }
  }

  const cashflowAccounts = accounts.filter(
    (account) =>
      account.class === 'LIABILITY' ||
      (account.class === 'ASSET' && ['BANK', 'CASH', 'BROKERAGE'].includes(account.subtype))
  );
  const correction = transactions.find((row) => row.id === replacementId);

  if (loading)
    return (
      <div className="page">
        <Skeleton rows={7} />
      </div>
    );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">MONEY MOVEMENT</p>
          <h1>Cashflow</h1>
          <p>Every operation stays balanced and fully traceable.</p>
        </div>
        <div className="header-actions">
          <button className="button secondary" onClick={() => setModal('account')}>
            Add account
          </button>
          <button
            className="button primary"
            onClick={() => {
              setReplacementId(undefined);
              setModal('operation');
            }}
          >
            New operation
          </button>
        </div>
      </header>
      {error && <ErrorBanner error={error} onRetry={() => void load()} />}

      <section className="account-strip">
        {cashflowAccounts.map((account) => (
          <article key={account.id}>
            <div>
              <span>{account.name}</span>
              <small>{account.subtype.replaceAll('_', ' ').toLowerCase()}</small>
            </div>
            <strong>
              <Money
                value={
                  account.class === 'LIABILITY'
                    ? Math.abs(Number(account.balance))
                    : account.balance
                }
                currency={account.currency}
              />
            </strong>
            <div className="card-actions">
              <button onClick={() => setReconcile(account)}>Reconcile</button>
              <button
                onClick={async () => {
                  if (window.confirm(`Archive ${account.name}?`)) {
                    await archiveAccount(account.id);
                    await load();
                  }
                }}
              >
                Archive
              </button>
            </div>
          </article>
        ))}
        <button className="add-tile" onClick={() => setModal('account')}>
          ＋<span>Add account</span>
        </button>
      </section>

      <div className="cashflow-layout">
        <section className="panel transactions-panel">
          <div className="panel-toolbar">
            <div>
              <p className="eyebrow">LEDGER</p>
              <h2>Transactions</h2>
            </div>
            <div className="filters">
              <input
                aria-label="From date"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <input
                aria-label="To date"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
              <select
                aria-label="Account filter"
                value={accountFilter}
                onChange={(event) => setAccountFilter(event.target.value)}
              >
                <option value="">All accounts</option>
                {cashflowAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {transactions.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              detail="Post income, an expense, a transfer or a liability payment."
              action={
                <button className="button primary" onClick={() => setModal('operation')}>
                  Post your first operation
                </button>
              }
            />
          ) : (
            <div className="transaction-table" role="table">
              <div className="table-head" role="row">
                <span>Date</span>
                <span>Description</span>
                <span>Account / category</span>
                <span>Amount</span>
                <span />
              </div>
              {transactions.map((row) => (
                <div
                  className={`table-row ${row.status === 'REVERSED' ? 'muted' : ''}`}
                  role="row"
                  key={row.id}
                >
                  <time>
                    {new Date(row.occurredOn).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                  <div>
                    <strong>{row.description}</strong>
                    <small className={`type-pill ${row.type.toLowerCase()}`}>
                      {row.type.replaceAll('_', ' ')}
                    </small>
                  </div>
                  <span>{entryLabels(row)}</span>
                  <strong>
                    <Money value={amountFor(row)} currency={currencyFor(row)} signed />
                  </strong>
                  <div className="row-actions">
                    <button
                      disabled={row.status === 'REVERSED' || !CORRECTABLE_TYPES.includes(row.type)}
                      onClick={() => {
                        setReplacementId(row.id);
                        setModal('operation');
                      }}
                    >
                      Correct
                    </button>
                    <button
                      disabled={row.status === 'REVERSED' || row.type === 'REVERSAL'}
                      onClick={() => void reverse(row)}
                    >
                      Reverse
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {nextCursor && (
            <button className="button secondary load-more" onClick={() => void loadMore()}>
              Load more
            </button>
          )}
        </section>

        <aside className="panel schedules-panel">
          <header>
            <div>
              <p className="eyebrow">AUTOMATION</p>
              <h2>Schedules</h2>
            </div>
            <button className="text-button" onClick={() => setModal('operation')}>
              ＋ Add
            </button>
          </header>
          {recurring.length === 0 ? (
            <p className="muted-copy">Recurring income, bills and transfers appear here.</p>
          ) : (
            recurring.map((schedule) => (
              <div className="schedule-row" key={schedule.id}>
                <div>
                  <strong>{schedule.description}</strong>
                  <small>
                    {schedule.interval.toLowerCase()} · next{' '}
                    {new Date(schedule.nextRunDate).toLocaleDateString()}
                  </small>
                </div>
                <button
                  className={schedule.status === 'ACTIVE' ? 'status active' : 'status'}
                  onClick={async () => {
                    await updateRecurring(schedule.id, {
                      status: schedule.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                    });
                    await load();
                  }}
                >
                  {schedule.status}
                </button>
              </div>
            ))
          )}
          <button className="button ghost wide" onClick={() => setModal('categories')}>
            Manage categories
          </button>
        </aside>
      </div>

      {modal === 'operation' && (
        <Modal
          title={replacementId ? 'Post a correction' : 'New operation'}
          onClose={() => setModal(null)}
        >
          <OperationForm
            accounts={cashflowAccounts}
            categories={categories}
            initialTransaction={correction}
            replacementId={replacementId}
            onCancel={() => setModal(null)}
            onSaved={() => {
              setModal(null);
              void load();
            }}
          />
        </Modal>
      )}
      {modal === 'account' && (
        <Modal title="Add financial account" onClose={() => setModal(null)}>
          <AccountForm
            onCancel={() => setModal(null)}
            onSaved={() => {
              setModal(null);
              void load();
            }}
          />
        </Modal>
      )}
      {modal === 'categories' && (
        <Modal title="Manage categories" onClose={() => setModal(null)}>
          <CategoryManager categories={categories} onChanged={() => void load()} />
        </Modal>
      )}
      {reconcile && (
        <Modal title={`Reconcile ${reconcile.name}`} onClose={() => setReconcile(null)}>
          <ReconcileForm
            account={reconcile}
            onCancel={() => setReconcile(null)}
            onDone={() => {
              setReconcile(null);
              void load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function amountFor(row: Transaction) {
  return row.entries.find((entry) => entry.accountId)?.originalAmount ?? '0';
}

function currencyFor(row: Transaction) {
  return row.entries.find((entry) => entry.accountId)?.originalCurrency ?? 'USD';
}

function entryLabels(row: Transaction) {
  return [
    ...new Set(
      row.entries
        .map((entry) => entry.account?.name ?? entry.category?.name)
        .filter((label): label is string => Boolean(label))
    ),
  ].join(' ↔ ');
}

function CategoryManager({
  categories,
  onChanged,
}: {
  categories: Category[];
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [error, setError] = useState('');
  return (
    <div>
      <form
        className="inline-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          try {
            await createCategory({ name, kind });
            setName('');
            onChanged();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Unable to create category');
          }
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Category name"
          required
        />
        <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="EXPENSE">Expense</option>
          <option value="INCOME">Income</option>
        </select>
        <button className="button primary">Add</button>
      </form>
      {error && <ErrorBanner error={error} />}
      <div className="manage-list">
        {categories.map((category) => (
          <div key={category.id}>
            <span>
              <strong>{category.name}</strong>
              <small>{category.kind.toLowerCase()}</small>
            </span>
            {!category.isSystem && (
              <button
                onClick={async () => {
                  await archiveCategory(category.id);
                  onChanged();
                }}
              >
                Archive
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
