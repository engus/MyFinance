import { FormEvent, useState } from 'react';
import {
  Account,
  confirmReconciliation,
  previewReconciliation,
  ReconciliationPreview,
} from '../../api/accounts';
import { ErrorBanner } from '../../components/AsyncState';
import { Money } from '../../components/Money';

export function ReconcileForm({
  account,
  onDone,
  onCancel,
}: {
  account: Account;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [balance, setBalance] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [preview, setPreview] = useState<ReconciliationPreview | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await previewReconciliation(account.id, {
        statedBalance: balance,
        date: new Date().toISOString().slice(0, 10),
        fxRate: fxRate || undefined,
      });
      setPreview(result);
      if (!result.requiresConfirmation) onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reconcile');
    } finally {
      setSaving(false);
    }
  }
  async function confirm() {
    if (!preview) return;
    setSaving(true);
    setError('');
    try {
      await confirmReconciliation(preview.id, fxRate || undefined);
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to confirm');
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      {preview?.requiresConfirmation ? (
        <div className="reconcile-preview">
          <p>
            Ledger balance{' '}
            <strong>
              <Money value={preview.expectedBalance} currency={account.currency} />
            </strong>
          </p>
          <p>
            Stated balance{' '}
            <strong>
              <Money value={preview.statedBalance} currency={account.currency} />
            </strong>
          </p>
          <div className="delta">
            <span>Unexplained difference</span>
            <strong>
              <Money value={preview.delta} currency={account.currency} signed />
            </strong>
          </div>
          {error && <ErrorBanner error={error} />}
          <div className="form-actions">
            <button className="button secondary" onClick={onCancel}>
              Cancel
            </button>
            <button className="button primary" onClick={confirm} disabled={saving}>
              Confirm adjustment
            </button>
          </div>
        </div>
      ) : (
        <form className="form-grid" onSubmit={submit}>
          <p className="span-2">
            Enter the balance shown by your bank. Due schedules are posted first, then only the
            unexplained difference is adjusted.
          </p>
          <label>
            Current balance
            <input
              inputMode="decimal"
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
              placeholder={account.balance}
              autoFocus
              required
            />
          </label>
          <label>
            FX rate (optional)
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
              {saving ? 'Checking…' : 'Preview reconciliation'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
