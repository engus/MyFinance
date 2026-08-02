import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from '../router';
import { Currency, SUPPORTED_CURRENCIES } from '@myfinance/contracts';
import { createAccount, fetchAccounts } from '../api/accounts';
import { fetchSettings, updateSettings } from '../api/settings';
import { ErrorBanner, Skeleton } from '../components/AsyncState';

export function OnboardingPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [name, setName] = useState('Primary account');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [accountCurrency, setAccountCurrency] = useState<Currency>('USD');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );
  const [balance, setBalance] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    Promise.all([fetchAccounts(), fetchSettings()])
      .then(([accounts, settings]) => {
        if (accounts.length) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setCurrency(settings.functionalCurrency);
        setAccountCurrency(settings.functionalCurrency);
        if (settings.timezone !== 'UTC') setTimezone(settings.timezone);
      })
      .catch((caught) => setError(caught.message))
      .finally(() => setChecking(false));
  }, [navigate]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await updateSettings({ functionalCurrency: currency, displayCurrency: currency, timezone });
      await createAccount({
        name,
        class: 'ASSET',
        subtype: 'BANK',
        currency: accountCurrency,
        openingBalance: balance || undefined,
        openingDate: new Date().toISOString().slice(0, 10),
        openingFxRate: accountCurrency !== currency && balance ? fxRate : undefined,
      });
      navigate('/dashboard');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create account');
    } finally {
      setSaving(false);
    }
  }
  if (checking)
    return (
      <div className="page">
        <Skeleton />
      </div>
    );
  return (
    <div className="onboarding">
      <div className="step-indicator">
        <span className="done">1</span>
        <i />
        <span className="active">2</span>
        <i />
        <span>3</span>
      </div>
      <div className="onboarding-card">
        <p className="eyebrow">SET UP YOUR LEDGER</p>
        <h1>Add your reporting preferences and first account</h1>
        <p>The opening balance is posted against equity, so it never inflates income.</p>
        {error && <ErrorBanner error={error} />}
        <form className="form-grid" onSubmit={submit}>
          <label>
            Functional currency
            <select
              value={currency}
              onChange={(event) => {
                const next = event.target.value as Currency;
                setCurrency(next);
                if (!balance) setAccountCurrency(next);
              }}
            >
              {SUPPORTED_CURRENCIES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <small>Locked after the first posting.</small>
          </label>
          <label>
            Timezone
            <input
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              required
            />
          </label>
          <label className="span-2">
            Account name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Account currency
            <select
              value={accountCurrency}
              onChange={(event) => setAccountCurrency(event.target.value as Currency)}
            >
              {SUPPORTED_CURRENCIES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Current balance
            <input
              inputMode="decimal"
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
              placeholder="0.00"
            />
          </label>
          {accountCurrency !== currency && balance && (
            <label className="span-2">
              FX rate to {currency}
              <input
                inputMode="decimal"
                value={fxRate}
                onChange={(event) => setFxRate(event.target.value)}
                placeholder={`1 ${accountCurrency} in ${currency}`}
                required
              />
            </label>
          )}
          <button className="button primary span-2" disabled={saving}>
            {saving ? 'Creating…' : 'Create account and continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
