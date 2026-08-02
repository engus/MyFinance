import { useState } from 'react';
import { Category } from '../../api/categories';
import { Account } from '../../api/accounts';
import { Transaction, deleteTransaction } from '../../api/transactions';
import { TransactionForm } from './TransactionForm';

export function TransactionColumn({
  title,
  kind,
  transactions,
  accounts,
  categories,
  onChanged,
}: {
  title: string;
  kind: 'INCOME' | 'EXPENSE';
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);

  async function handleDelete(id: string) {
    await deleteTransaction(id);
    onChanged();
  }

  return (
    <div className="cashflow-column">
      <h2>
        {title}
        <button onClick={() => setAdding(true)}>+ Добавить</button>
      </h2>
      {adding && (
        <TransactionForm
          kind={kind}
          accounts={accounts}
          categories={categories.filter((c) => c.kind === kind)}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {transactions.map((t) => (
        <div className="transaction-row" key={t.id}>
          <span>
            {t.description}
            {t.frequency === 'RECURRING' && <span className="recurring-badge">⟳ {t.interval}</span>}
          </span>
          <span>
            {t.frequency === 'RECURRING' ? t.templateAmount : t.entries.find((e) => e.accountId)?.amount}{' '}
            {t.templateCurrency ?? t.entries[0]?.currency}
          </span>
          <button onClick={() => handleDelete(t.id)}>Удалить</button>
        </div>
      ))}
    </div>
  );
}
