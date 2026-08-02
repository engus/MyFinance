import { FormEvent, useState } from 'react';
import { Account } from '../../api/accounts';
import { Category } from '../../api/categories';
import { createOneOffTransaction, createRecurringTransaction } from '../../api/transactions';

const INTERVALS = ['WEEK', 'MONTH', 'QUARTER', 'YEAR', 'CUSTOM'] as const;

export function TransactionForm({
  kind,
  accounts,
  categories,
  onDone,
  onCancel,
}: {
  kind: 'INCOME' | 'EXPENSE';
  accounts: Account[];
  categories: Category[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [isRecurring, setIsRecurring] = useState(false);
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>('MONTH');
  const [customDays, setCustomDays] = useState('30');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      setError('Выберите счёт');
      return;
    }

    const magnitude = Math.abs(Number(amount));
    const signedAmount = kind === 'EXPENSE' ? `-${magnitude}` : `${magnitude}`;

    try {
      if (isRecurring) {
        await createRecurringTransaction({
          description,
          accountId,
          categoryId,
          amount: signedAmount,
          currency: account.currency,
          interval,
          customDays: interval === 'CUSTOM' ? Number(customDays) : undefined,
          startDate: new Date().toISOString(),
        });
      } else {
        await createOneOffTransaction({
          description,
          date: new Date().toISOString(),
          entries: [
            { accountId, amount: signedAmount, currency: account.currency },
            { categoryId, amount: (-Number(signedAmount)).toString(), currency: account.currency },
          ],
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    }
  }

  return (
    <form className="transaction-form" onSubmit={handleSubmit}>
      <label>
        Описание
        <input value={description} onChange={(e) => setDescription(e.target.value)} required />
      </label>
      <label>
        Счёт
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Категория
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Сумма
        <input value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </label>
      <label>
        <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
        Регулярная
      </label>
      {isRecurring && (
        <label>
          Периодичность
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as (typeof INTERVALS)[number])}
          >
            {INTERVALS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
      )}
      {isRecurring && interval === 'CUSTOM' && (
        <label>
          Дней
          <input
            type="number"
            min="1"
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
          />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="submit">Сохранить</button>
      <button type="button" onClick={onCancel}>
        Отмена
      </button>
    </form>
  );
}
