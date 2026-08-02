import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Currency, SUPPORTED_CURRENCIES } from '@myfinance/contracts';
import {
  addValuation,
  Asset,
  createAsset,
  createLiability,
  fetchAssets,
  fetchLiabilities,
  Liability,
  updateAsset,
  updateLiability,
} from '../api/assets';
import { EmptyState, ErrorBanner, Skeleton } from '../components/AsyncState';
import { Money } from '../components/Money';
import { Modal } from '../components/Modal';

export function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'asset' | 'liability' | null>(null);
  const [valuationAsset, setValuationAsset] = useState<Asset | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [assetRows, liabilityRows] = await Promise.all([fetchAssets(), fetchLiabilities()]);
      setAssets(assetRows);
      setLiabilities(liabilityRows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load assets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading)
    return (
      <div className="page">
        <Skeleton rows={6} />
      </div>
    );

  const assetCurrency = singleCurrency(assets.map((asset) => asset.account.currency));
  const liabilityCurrency = singleCurrency(liabilities.map((item) => item.currency));
  const assetTotal = assets.reduce(
    (sum, asset) => sum + Number(asset.currentValuation?.amount ?? 0),
    0
  );
  const debtTotal = liabilities.reduce((sum, item) => sum + Math.abs(Number(item.balance)), 0);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">BALANCE SHEET</p>
          <h1>Assets & liabilities</h1>
          <p>Track ownership, manual value snapshots and debt in the same ledger.</p>
        </div>
        <div className="header-actions">
          <button className="button secondary" onClick={() => setMode('liability')}>
            Add liability
          </button>
          <button className="button primary" onClick={() => setMode('asset')}>
            Add asset
          </button>
        </div>
      </header>
      {error && <ErrorBanner error={error} onRetry={() => void load()} />}

      <section className="position-summary">
        <article>
          <span>Tracked asset value</span>
          <strong>
            {assets.length === 0 ? (
              '—'
            ) : assetCurrency ? (
              <Money value={assetTotal} currency={assetCurrency} />
            ) : (
              'Mixed currencies'
            )}
          </strong>
        </article>
        <article>
          <span>Outstanding debt</span>
          <strong>
            {liabilities.length === 0 ? (
              '—'
            ) : liabilityCurrency ? (
              <Money value={debtTotal} currency={liabilityCurrency} />
            ) : (
              'Mixed currencies'
            )}
          </strong>
        </article>
        <article className="accent">
          <span>Positions</span>
          <strong>{assets.length + liabilities.length}</strong>
        </article>
      </section>

      <section className="asset-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">OWNED</p>
            <h2>Assets</h2>
          </div>
        </div>
        {assets.length === 0 ? (
          <EmptyState
            title="No assets yet"
            detail="Add property, a vehicle, a business, a collectible or a manually valued investment portfolio."
            action={
              <button className="button primary" onClick={() => setMode('asset')}>
                Add an asset
              </button>
            }
          />
        ) : (
          <div className="asset-grid">
            {assets.map((asset) => (
              <article className="asset-card" key={asset.id}>
                <div className={`asset-icon ${asset.type.toLowerCase()}`}>
                  {asset.type === 'SECURITY' ? '↗' : asset.type === 'REAL_ESTATE' ? '⌂' : '◇'}
                </div>
                <div className="asset-card-main">
                  <small>{asset.type.replaceAll('_', ' ')}</small>
                  <h3>{asset.account.name}</h3>
                  <p>
                    {[asset.institution, asset.region, asset.countryCode]
                      .filter(Boolean)
                      .join(' · ') || 'Private asset'}
                  </p>
                </div>
                <div className="asset-value">
                  <strong>
                    <Money
                      value={asset.currentValuation?.amount}
                      currency={asset.account.currency}
                    />
                  </strong>
                  <small>
                    {asset.currentValuation
                      ? `valued ${new Date(asset.currentValuation.valuationDate).toLocaleDateString()}`
                      : 'not valued'}
                  </small>
                </div>
                {asset.type === 'SECURITY' && (
                  <p className="manual-security-note">
                    Manual total-value snapshots · no live quotes
                  </p>
                )}
                <ValuationHistory asset={asset} />
                <div className="card-actions">
                  <button onClick={() => setValuationAsset(asset)}>Record value</button>
                  <button
                    onClick={async () => {
                      if (window.confirm(`Archive ${asset.account.name}?`)) {
                        await updateAsset(asset.id, { isArchived: true });
                        await load();
                      }
                    }}
                  >
                    Archive
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="asset-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">OWED</p>
            <h2>Liabilities</h2>
          </div>
        </div>
        {liabilities.length === 0 ? (
          <EmptyState
            title="No liabilities"
            detail="Mortgages, loans and credit cards appear here."
          />
        ) : (
          <div className="liability-list">
            {liabilities.map((item) => (
              <article key={item.id}>
                <div>
                  <span className="asset-icon debt">↓</span>
                  <div>
                    <h3>{item.name}</h3>
                    <p>{item.liabilityProfile?.creditor || item.subtype.replaceAll('_', ' ')}</p>
                  </div>
                </div>
                <div>
                  <strong>
                    <Money value={Math.abs(Number(item.balance))} currency={item.currency} />
                  </strong>
                  <small>
                    {item.liabilityProfile?.annualInterestRate
                      ? `${item.liabilityProfile.annualInterestRate}% APR`
                      : 'Rate not set'}
                  </small>
                </div>
                <button
                  onClick={async () => {
                    if (window.confirm(`Archive ${item.name}?`)) {
                      await updateLiability(item.id, { isArchived: true });
                      await load();
                    }
                  }}
                >
                  Archive
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {mode === 'asset' && (
        <Modal title="Add an asset" onClose={() => setMode(null)}>
          <AssetForm
            onCancel={() => setMode(null)}
            onSaved={() => {
              setMode(null);
              void load();
            }}
          />
        </Modal>
      )}
      {mode === 'liability' && (
        <Modal title="Add a liability" onClose={() => setMode(null)}>
          <LiabilityForm
            onCancel={() => setMode(null)}
            onSaved={() => {
              setMode(null);
              void load();
            }}
          />
        </Modal>
      )}
      {valuationAsset && (
        <Modal
          title={`Value ${valuationAsset.account.name}`}
          onClose={() => setValuationAsset(null)}
        >
          <ValuationForm
            asset={valuationAsset}
            onCancel={() => setValuationAsset(null)}
            onSaved={() => {
              setValuationAsset(null);
              void load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function singleCurrency(currencies: string[]) {
  const unique = new Set(currencies);
  return unique.size === 1 ? currencies[0] : undefined;
}

function ValuationHistory({ asset }: { asset: Asset }) {
  if (asset.valuations.length === 0) return null;
  return (
    <details className="valuation-history">
      <summary>Valuation history ({asset.valuations.length})</summary>
      <div>
        {asset.valuations.map((valuation) => (
          <p key={valuation.id}>
            <time>{new Date(valuation.valuationDate).toLocaleDateString()}</time>
            <strong>
              <Money value={valuation.amount} currency={valuation.currency} />
            </strong>
          </p>
        ))}
      </div>
    </details>
  );
}

function AssetForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<
    'REAL_ESTATE' | 'VEHICLE' | 'SECURITY' | 'PRIVATE_BUSINESS' | 'COLLECTIBLE' | 'OTHER'
  >('REAL_ESTATE');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [value, setValue] = useState('');
  const [valuationDate, setValuationDate] = useState(new Date().toISOString().slice(0, 10));
  const [fxRate, setFxRate] = useState('');
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('');
  const [institution, setInstitution] = useState('');
  const [notes, setNotes] = useState('');
  const [ownership, setOwnership] = useState('100');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createAsset({
        name,
        type,
        currency,
        initialValue: value,
        valuationDate,
        fxRate: fxRate || undefined,
        countryCode: country || undefined,
        region: region || undefined,
        institution: institution || undefined,
        ownershipShare: ownership,
        notes: notes || undefined,
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create asset');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="span-2">
        Asset name
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label>
        Type
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
          <option value="REAL_ESTATE">Real estate</option>
          <option value="VEHICLE">Vehicle</option>
          <option value="SECURITY">Investment portfolio (manual)</option>
          <option value="PRIVATE_BUSINESS">Private business</option>
          <option value="COLLECTIBLE">Collectible</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <label>
        Currency
        <select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>
          {SUPPORTED_CURRENCIES.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      {type === 'SECURITY' && (
        <p className="span-2 form-hint">
          Enter the portfolio’s total value now, then add a new manual snapshot each month. Tickers,
          quantities and live quotes are intentionally deferred.
        </p>
      )}
      <label>
        Current total value
        <input
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
        />
      </label>
      <label>
        Initial value date
        <input
          type="date"
          value={valuationDate}
          onChange={(event) => setValuationDate(event.target.value)}
          required
        />
      </label>
      <label>
        Ownership %
        <input
          inputMode="decimal"
          value={ownership}
          onChange={(event) => setOwnership(event.target.value)}
          required
        />
      </label>
      <label>
        Institution
        <input
          value={institution}
          onChange={(event) => setInstitution(event.target.value)}
          placeholder="Optional"
        />
      </label>
      <label>
        Country code
        <input
          value={country}
          maxLength={2}
          onChange={(event) => setCountry(event.target.value.toUpperCase())}
          placeholder="US"
        />
      </label>
      <label>
        Region
        <input
          value={region}
          onChange={(event) => setRegion(event.target.value)}
          placeholder="Optional"
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
      <label className="span-2">
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
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
          {saving ? 'Creating…' : 'Add asset'}
        </button>
      </div>
    </form>
  );
}

function LiabilityForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [subtype, setSubtype] = useState<'MORTGAGE' | 'LOAN' | 'CREDIT_CARD'>('MORTGAGE');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [balance, setBalance] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [creditor, setCreditor] = useState('');
  const [rate, setRate] = useState('');
  const [maturity, setMaturity] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createLiability({
        name,
        subtype,
        currency,
        openingBalance: balance,
        openingDate: new Date().toISOString().slice(0, 10),
        fxRate: fxRate || undefined,
        creditor: creditor || undefined,
        annualInterestRate: rate || undefined,
        maturityDate: maturity || undefined,
        notes: notes || undefined,
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create liability');
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="span-2">
        Liability name
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label>
        Type
        <select
          value={subtype}
          onChange={(event) => setSubtype(event.target.value as typeof subtype)}
        >
          <option value="MORTGAGE">Mortgage</option>
          <option value="LOAN">Loan</option>
          <option value="CREDIT_CARD">Credit card</option>
        </select>
      </label>
      <label>
        Currency
        <select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>
          {SUPPORTED_CURRENCIES.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label>
        Amount owed
        <input
          inputMode="decimal"
          value={balance}
          onChange={(event) => setBalance(event.target.value)}
          required
        />
      </label>
      <label>
        Creditor
        <input value={creditor} onChange={(event) => setCreditor(event.target.value)} />
      </label>
      <label>
        Annual interest %
        <input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} />
      </label>
      <label>
        Maturity date
        <input type="date" value={maturity} onChange={(event) => setMaturity(event.target.value)} />
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
      <label className="span-2">
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
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
          {saving ? 'Creating…' : 'Add liability'}
        </button>
      </div>
    </form>
  );
}

function ValuationForm({
  asset,
  onSaved,
  onCancel,
}: {
  asset: Asset;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(asset.currentValuation?.amount ?? '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [fxRate, setFxRate] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await addValuation(asset.id, {
        amount,
        currency: asset.account.currency as Currency,
        date,
        source: 'MANUAL',
        fxRate: fxRate || undefined,
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to record valuation');
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="form-grid" onSubmit={submit}>
      <p className="span-2 form-hint">
        Record the total value on this date. For investments, one monthly snapshot is sufficient.
      </p>
      <label>
        Value
        <input
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
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
          {saving ? 'Posting…' : 'Record valuation'}
        </button>
      </div>
    </form>
  );
}
