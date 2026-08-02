import { FormEvent, useMemo, useState } from 'react';
import { CreateOperationInput, Currency, RecurrenceInput } from '@myfinance/contracts';
import { Account } from '../../api/accounts';
import { Category } from '../../api/categories';
import {
  createOperation,
  createRecurring,
  replaceTransaction,
  Transaction,
} from '../../api/transactions';
import { ErrorBanner } from '../../components/AsyncState';

type OperationType = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'LIABILITY_PAYMENT';

export function OperationForm({
  accounts,
  categories,
  initialTransaction,
  replacementId,
  onSaved,
  onCancel,
}: {
  accounts: Account[];
  categories: Category[];
  initialTransaction?: Transaction;
  replacementId?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const assets = accounts.filter(
    (account) =>
      account.class === 'ASSET' && ['BANK', 'CASH', 'BROKERAGE'].includes(account.subtype)
  );
  const liabilities = accounts.filter((account) => account.class === 'LIABILITY');
  const initial = useMemo(
    () => operationDefaults(initialTransaction, assets, liabilities),
    [initialTransaction, assets, liabilities]
  );
  const [type, setType] = useState<OperationType>(initial.type);
  const [description, setDescription] = useState(initial.description);
  const [date, setDate] = useState(initial.date);
  const [accountId, setAccountId] = useState(initial.accountId);
  const [secondAccountId, setSecondAccountId] = useState(initial.secondAccountId);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [amount, setAmount] = useState(initial.amount);
  const [toAmount, setToAmount] = useState(initial.toAmount);
  const [feeAmount, setFeeAmount] = useState(initial.feeAmount);
  const [interestAmount, setInterestAmount] = useState(initial.interestAmount);
  const [recurring, setRecurring] = useState(false);
  const [interval, setInterval] = useState<'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM'>(
    'MONTH'
  );
  const [customDays, setCustomDays] = useState('30');
  const [fxRate, setFxRate] = useState(initial.fxRate);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const matchingCategories = useMemo(
    () => categories.filter((category) => category.kind === type),
    [categories, type]
  );
  const selectedCategory = categoryId || matchingCategories[0]?.id || '';
  const selectedAccount = accounts.find((account) => account.id === accountId);

  function operation(): CreateOperationInput {
    if (type === 'TRANSFER')
      return {
        type,
        description,
        date,
        fromAccountId: accountId,
        toAccountId: secondAccountId,
        fromAmount: amount,
        toAmount: toAmount || amount,
        feeAmount: feeAmount || undefined,
        fxRate: fxRate || undefined,
      };
    if (type === 'LIABILITY_PAYMENT')
      return {
        type,
        description,
        date,
        cashAccountId: accountId,
        liabilityAccountId: secondAccountId,
        principalAmount: amount,
        interestAmount: interestAmount || '0',
        fxRate: fxRate || undefined,
      };
    return {
      type,
      description,
      date,
      accountId,
      categoryId: selectedCategory,
      amount,
      currency: selectedAccount?.currency as Currency,
      fxRate: fxRate || undefined,
    } as CreateOperationInput;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = operation();
      if (replacementId) await replaceTransaction(replacementId, payload);
      else if (recurring)
        await createRecurring({
          operation: payload as RecurrenceInput['operation'],
          interval,
          customDays: interval === 'CUSTOM' ? Number(customDays) : undefined,
          startDate: date,
        });
      else await createOperation(payload);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save operation');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>
        Operation
        <select
          value={type}
          onChange={(event) => {
            const nextType = event.target.value as OperationType;
            setType(nextType);
            setCategoryId('');
            setAccountId(assets[0]?.id ?? '');
            setSecondAccountId(
              nextType === 'LIABILITY_PAYMENT'
                ? (liabilities[0]?.id ?? '')
                : (assets[1]?.id ?? assets[0]?.id ?? '')
            );
          }}
        >
          <option value="EXPENSE">Expense</option>
          <option value="INCOME">Income</option>
          <option value="TRANSFER">Transfer</option>
          {liabilities.length > 0 && <option value="LIABILITY_PAYMENT">Liability payment</option>}
        </select>
      </label>
      <label>
        Date
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </label>
      <label className="span-2">
        Description
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What was this for?"
          required
        />
      </label>
      <label>
        {type === 'TRANSFER'
          ? 'From account'
          : type === 'LIABILITY_PAYMENT'
            ? 'Cash account'
            : 'Account'}
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>
          {assets.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} · {account.currency}
            </option>
          ))}
        </select>
      </label>
      {(type === 'TRANSFER' || type === 'LIABILITY_PAYMENT') && (
        <label>
          {type === 'TRANSFER' ? 'To account' : 'Liability'}
          <select
            value={secondAccountId}
            onChange={(event) => setSecondAccountId(event.target.value)}
            required
          >
            {(type === 'TRANSFER' ? assets : liabilities).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.currency}
              </option>
            ))}
          </select>
        </label>
      )}
      {(type === 'INCOME' || type === 'EXPENSE') && (
        <label>
          Category
          <select
            value={selectedCategory}
            onChange={(event) => setCategoryId(event.target.value)}
            required
          >
            {matchingCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {type === 'LIABILITY_PAYMENT'
          ? 'Principal'
          : type === 'TRANSFER'
            ? 'From amount'
            : 'Amount'}
        <input
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
          required
        />
      </label>
      {type === 'TRANSFER' && (
        <>
          <label>
            To amount
            <input
              inputMode="decimal"
              value={toAmount}
              onChange={(event) => setToAmount(event.target.value)}
              placeholder={amount || '0.00'}
            />
          </label>
          <label>
            Fee (optional)
            <input
              inputMode="decimal"
              value={feeAmount}
              onChange={(event) => setFeeAmount(event.target.value)}
              placeholder="0.00"
            />
          </label>
        </>
      )}
      {type === 'LIABILITY_PAYMENT' && (
        <label>
          Interest
          <input
            inputMode="decimal"
            value={interestAmount}
            onChange={(event) => setInterestAmount(event.target.value)}
          />
        </label>
      )}
      {selectedAccount && (
        <label>
          FX rate to functional currency (optional)
          <input
            inputMode="decimal"
            value={fxRate}
            onChange={(event) => setFxRate(event.target.value)}
            placeholder="Use cached market rate"
          />
        </label>
      )}
      {!replacementId && (
        <label className="checkbox span-2">
          <input
            type="checkbox"
            checked={recurring}
            onChange={(event) => setRecurring(event.target.checked)}
          />{' '}
          Repeat this operation
        </label>
      )}
      {recurring && (
        <>
          <label>
            Frequency
            <select
              value={interval}
              onChange={(event) => setInterval(event.target.value as typeof interval)}
            >
              <option value="WEEK">Weekly</option>
              <option value="MONTH">Monthly</option>
              <option value="QUARTER">Quarterly</option>
              <option value="YEAR">Yearly</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </label>
          {interval === 'CUSTOM' && (
            <label>
              Every N days
              <input
                type="number"
                min="1"
                max="3650"
                value={customDays}
                onChange={(event) => setCustomDays(event.target.value)}
              />
            </label>
          )}
        </>
      )}
      {error && (
        <div className="span-2">
          <ErrorBanner error={error} />
        </div>
      )}
      <div className="form-actions span-2">
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="button primary" disabled={saving}>
          {saving
            ? 'Saving…'
            : replacementId
              ? 'Post correction'
              : recurring
                ? 'Create schedule'
                : 'Post operation'}
        </button>
      </div>
    </form>
  );
}

function operationDefaults(
  transaction: Transaction | undefined,
  assets: Account[],
  liabilities: Account[]
) {
  const fallback = {
    type: 'EXPENSE' as OperationType,
    description: '',
    date: new Date().toISOString().slice(0, 10),
    accountId: assets[0]?.id ?? '',
    secondAccountId: assets[1]?.id ?? assets[0]?.id ?? '',
    categoryId: '',
    amount: '',
    toAmount: '',
    feeAmount: '',
    interestAmount: '0',
    fxRate: '',
  };
  if (
    !transaction ||
    !['INCOME', 'EXPENSE', 'TRANSFER', 'LIABILITY_PAYMENT'].includes(transaction.type)
  ) {
    return fallback;
  }
  const accountEntries = transaction.entries.filter((entry) => entry.accountId);
  const categoryEntries = transaction.entries.filter((entry) => entry.categoryId);
  const negativeAccounts = accountEntries.filter((entry) => entry.originalAmount.startsWith('-'));
  const positiveAccounts = accountEntries.filter((entry) => !entry.originalAmount.startsWith('-'));
  const magnitude = (value: string) => value.replace(/^-/, '');
  const base = {
    ...fallback,
    type: transaction.type as OperationType,
    description: transaction.description,
    date: transaction.occurredOn.slice(0, 10),
  };
  if (transaction.type === 'INCOME' || transaction.type === 'EXPENSE') {
    const account = accountEntries[0];
    return {
      ...base,
      accountId: account?.accountId ?? fallback.accountId,
      categoryId: categoryEntries[0]?.categoryId ?? '',
      amount: account ? magnitude(account.originalAmount) : '',
      fxRate: account?.fxRate ?? '',
    };
  }
  if (transaction.type === 'TRANSFER') {
    const from = negativeAccounts[0];
    const to = positiveAccounts[0];
    const fee = categoryEntries.find((entry) => entry.originalAmount !== '0');
    return {
      ...base,
      accountId: from?.accountId ?? fallback.accountId,
      secondAccountId: to?.accountId ?? fallback.secondAccountId,
      amount: from ? magnitude(from.originalAmount) : '',
      toAmount: to ? magnitude(to.originalAmount) : '',
      feeAmount: fee ? magnitude(fee.originalAmount) : '',
      fxRate: from?.fxRate ?? '',
    };
  }
  const cash = accountEntries.find((entry) => entry.account?.class === 'ASSET');
  const liability = accountEntries.find((entry) => entry.account?.class === 'LIABILITY');
  const interest = categoryEntries[0];
  return {
    ...base,
    accountId: cash?.accountId ?? fallback.accountId,
    secondAccountId: liability?.accountId ?? liabilities[0]?.id ?? '',
    amount: liability ? magnitude(liability.originalAmount) : '',
    interestAmount: interest ? magnitude(interest.originalAmount) : '0',
    fxRate: cash?.fxRate ?? '',
  };
}
