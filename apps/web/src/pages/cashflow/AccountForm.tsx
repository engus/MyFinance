import { FormEvent, useState } from 'react';
import { Currency, SUPPORTED_CURRENCIES } from '@myfinance/contracts';
import { createAccount } from '../../api/accounts';
import { ErrorBanner } from '../../components/AsyncState';

export function AccountForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [subtype, setSubtype] = useState<'BANK' | 'CASH' | 'BROKERAGE'>('BANK');
  const [balance, setBalance] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createAccount({
        name,
        class: 'ASSET',
        subtype,
        currency,
        openingBalance: balance || undefined,
        openingDate: new Date().toISOString().slice(0, 10),
        openingFxRate: fxRate || undefined,
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create account');
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="span-2">
        Account name
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label>
        Type
        <select
          value={subtype}
          onChange={(event) => setSubtype(event.target.value as typeof subtype)}
        >
          <option value="BANK">Bank account</option>
          <option value="CASH">Cash</option>
          <option value="BROKERAGE">Brokerage cash</option>
        </select>
      </label>
      <label>
        Currency
        <select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>
          {SUPPORTED_CURRENCIES.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        Opening balance
        <input
          inputMode="decimal"
          value={balance}
          onChange={(event) => setBalance(event.target.value)}
          placeholder="0.00"
        />
      </label>
      <label>
        Opening FX rate (optional)
        <input
          inputMode="decimal"
          value={fxRate}
          onChange={(event) => setFxRate(event.target.value)}
          placeholder="Use cached market rate"
        />
      </label>
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
          {saving ? 'Creating…' : 'Create account'}
        </button>
      </div>
    </form>
  );
}
