import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Currency, SUPPORTED_CURRENCIES } from '@myfinance/contracts';
import { CurrentUser } from '../api/auth';
import {
  confirmTwoFactor,
  deleteAccount,
  disableTwoFactor,
  fetchSessions,
  fetchSettings,
  revokeSession,
  saveManualRate,
  SessionInfo,
  Settings,
  setupTwoFactor,
  updateCredentials,
  updateSettings,
} from '../api/settings';
import { ErrorBanner, Skeleton } from '../components/AsyncState';
import { Modal } from '../components/Modal';

type SecurityMode = 'credentials' | '2fa' | 'disable2fa' | 'delete' | null;

export function SettingsPage({
  onUserChanged,
}: {
  onUserChanged: (user: CurrentUser | null) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [securityMode, setSecurityMode] = useState<SecurityMode>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [profile, sessionRows] = await Promise.all([fetchSettings(), fetchSessions()]);
      setSettings(profile);
      setSessions(sessionRows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load settings');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!settings) {
    return (
      <div className="page">
        {error ? <ErrorBanner error={error} onRetry={() => void load()} /> : <Skeleton rows={6} />}
      </div>
    );
  }
  const manualFrom =
    settings.functionalCurrency === settings.displayCurrency
      ? (SUPPORTED_CURRENCIES.find((currency) => currency !== settings.displayCurrency) ??
        settings.functionalCurrency)
      : settings.functionalCurrency;

  async function savePreferences(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    if (!settings) return;
    try {
      const updated = await updateSettings({
        displayCurrency: settings.displayCurrency,
        timezone: settings.timezone,
        reconciliationMode: settings.reconciliationMode,
      });
      setSettings(updated);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save preferences');
    }
  }

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">PRIVATE ACCOUNT</p>
          <h1>Settings</h1>
          <p>Control reporting preferences and account security.</p>
        </div>
      </header>
      {error && <ErrorBanner error={error} />}
      <div className="settings-grid">
        <section className="panel">
          <header>
            <div>
              <p className="eyebrow">PREFERENCES</p>
              <h2>Reporting</h2>
            </div>
          </header>
          <form className="settings-form" onSubmit={savePreferences}>
            <label>
              Functional currency
              <input value={settings.functionalCurrency} disabled />
              <small>Locked after the first ledger posting.</small>
            </label>
            <label>
              Display currency
              <select
                value={settings.displayCurrency}
                onChange={(event) =>
                  setSettings({ ...settings, displayCurrency: event.target.value as Currency })
                }
              >
                {SUPPORTED_CURRENCIES.map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
            <label>
              Timezone
              <input
                value={settings.timezone}
                onChange={(event) => setSettings({ ...settings, timezone: event.target.value })}
              />
            </label>
            <label>
              Reconciliation mode
              <select
                value={settings.reconciliationMode}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    reconciliationMode: event.target.value as Settings['reconciliationMode'],
                  })
                }
              >
                <option value="AUTO">Apply automatically</option>
                <option value="CONFIRM">Always confirm</option>
              </select>
            </label>
            <div className="form-actions">
              <span className="success-text">{saved ? 'Preferences saved' : ''}</span>
              <button className="button primary">Save preferences</button>
            </div>
          </form>
          <ManualRateForm fromDefault={manualFrom} toDefault={settings.displayCurrency} />
        </section>

        <section className="panel">
          <header>
            <div>
              <p className="eyebrow">SECURITY</p>
              <h2>Sign-in protection</h2>
            </div>
          </header>
          <div className="setting-row">
            <div>
              <strong>Email and password</strong>
              <span>{settings.email}</span>
            </div>
            <button className="button secondary" onClick={() => setSecurityMode('credentials')}>
              Change
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>Authenticator app</strong>
              <span>
                {settings.totpEnabled
                  ? 'Two-factor authentication is enabled'
                  : 'Add a second factor to your account'}
              </span>
            </div>
            <button
              className="button secondary"
              onClick={() => setSecurityMode(settings.totpEnabled ? 'disable2fa' : '2fa')}
            >
              {settings.totpEnabled ? 'Disable' : 'Set up'}
            </button>
          </div>
        </section>

        <section className="panel span-2">
          <header>
            <div>
              <p className="eyebrow">SESSIONS</p>
              <h2>Signed-in devices</h2>
            </div>
          </header>
          <div className="session-list">
            {sessions.map((session) => (
              <div key={session.id}>
                <span className="session-icon">▣</span>
                <div>
                  <strong>
                    {session.userAgent?.split(' ').slice(0, 5).join(' ') || 'Unknown browser'}{' '}
                    {session.current && <em>Current</em>}
                  </strong>
                  <span>
                    {session.ipAddress || 'Unknown IP'} · active{' '}
                    {new Date(session.lastSeenAt).toLocaleString()}
                  </span>
                </div>
                {!session.current && (
                  <button
                    onClick={async () => {
                      await revokeSession(session.id);
                      await load();
                    }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="panel danger-zone span-2">
          <div>
            <h2>Delete account</h2>
            <p>Permanently remove the user, ledger, assets and sessions. This cannot be undone.</p>
          </div>
          <button className="button danger" onClick={() => setSecurityMode('delete')}>
            Delete account
          </button>
        </section>
      </div>

      {securityMode === 'credentials' && (
        <Modal title="Change credentials" onClose={() => setSecurityMode(null)}>
          <CredentialsForm
            onDone={() => {
              setSecurityMode(null);
              void load();
            }}
          />
        </Modal>
      )}
      {securityMode === '2fa' && (
        <Modal title="Set up two-factor authentication" onClose={() => setSecurityMode(null)}>
          <TwoFactorSetup
            onDone={() => {
              setSecurityMode(null);
              void load();
            }}
          />
        </Modal>
      )}
      {securityMode === 'disable2fa' && (
        <Modal title="Disable two-factor authentication" onClose={() => setSecurityMode(null)}>
          <SensitiveForm
            action="disable"
            onDone={() => {
              setSecurityMode(null);
              void load();
            }}
          />
        </Modal>
      )}
      {securityMode === 'delete' && (
        <Modal title="Delete your account" onClose={() => setSecurityMode(null)}>
          <SensitiveForm action="delete" onDone={() => onUserChanged(null)} />
        </Modal>
      )}
    </div>
  );
}

function ManualRateForm({
  fromDefault,
  toDefault,
}: {
  fromDefault: Currency;
  toDefault: Currency;
}) {
  const [fromCurrency, setFromCurrency] = useState<Currency>(fromDefault);
  const [toCurrency, setToCurrency] = useState<Currency>(toDefault);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rate, setRate] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="manual-rate-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        setStatus('');
        try {
          await saveManualRate({ fromCurrency, toCurrency, date, rate });
          setStatus('Manual rate saved');
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Unable to save rate');
        }
      }}
    >
      <div>
        <p className="eyebrow">MANUAL FALLBACK</p>
        <h3>Dated FX rate</h3>
        <p>Used before market data for this date and only for your account.</p>
      </div>
      <div className="manual-rate-fields">
        <label>
          From
          <select
            value={fromCurrency}
            onChange={(event) => setFromCurrency(event.target.value as Currency)}
          >
            {SUPPORTED_CURRENCIES.map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </label>
        <label>
          To
          <select
            value={toCurrency}
            onChange={(event) => setToCurrency(event.target.value as Currency)}
          >
            {SUPPORTED_CURRENCIES.map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
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
        <label>
          Rate
          <input
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            placeholder={`1 ${fromCurrency} in ${toCurrency}`}
            required
          />
        </label>
      </div>
      {error && <ErrorBanner error={error} />}
      <div className="form-actions">
        <span className="success-text">{status}</span>
        <button className="button secondary">Save manual rate</button>
      </div>
    </form>
  );
}

function CredentialsForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="form-grid"
      onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        try {
          await updateCredentials({
            currentPassword: password,
            newEmail: email || undefined,
            newPassword: newPassword || undefined,
            totpCode: code || undefined,
          });
          onDone();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Unable to update credentials');
        }
      }}
    >
      <label className="span-2">
        Current password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <label className="span-2">
        New email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Leave blank to keep current"
        />
      </label>
      <label className="span-2">
        New password
        <input
          type="password"
          minLength={12}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="Leave blank to keep current"
        />
      </label>
      <label className="span-2">
        Authentication code
        <input value={code} onChange={(event) => setCode(event.target.value)} />
      </label>
      {error && (
        <div className="span-2">
          <ErrorBanner error={error} />
        </div>
      )}
      <button className="button primary span-2">Save credentials</button>
    </form>
  );
}

function TwoFactorSetup({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpAuthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    setupTwoFactor()
      .then(setSetup)
      .catch((caught) => setError(caught.message));
  }, []);
  if (recovery.length)
    return (
      <div>
        <p>Store these recovery codes somewhere safe. They will not be shown again.</p>
        <pre className="recovery-codes">{recovery.join('\n')}</pre>
        <button className="button primary wide" onClick={onDone}>
          I saved the codes
        </button>
      </div>
    );
  return (
    <form
      className="form-grid"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          setRecovery((await confirmTwoFactor(code)).recoveryCodes);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Invalid code');
        }
      }}
    >
      <p className="span-2">
        Add the secret below to your authenticator app, then enter the six-digit code.
      </p>
      <code className="totp-secret span-2">{setup?.secret || 'Generating…'}</code>
      <label className="span-2">
        Six-digit code
        <input
          inputMode="numeric"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
        />
      </label>
      {error && (
        <div className="span-2">
          <ErrorBanner error={error} />
        </div>
      )}
      <button className="button primary span-2">Enable two-factor authentication</button>
    </form>
  );
}

function SensitiveForm({ action, onDone }: { action: 'disable' | 'delete'; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="form-grid"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          if (action === 'disable') await disableTwoFactor(password, code);
          else await deleteAccount(password, code || undefined);
          onDone();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Unable to continue');
        }
      }}
    >
      <p className="span-2">
        {action === 'delete'
          ? 'This permanently removes all financial data.'
          : 'Your account will return to password-only protection.'}
      </p>
      <label className="span-2">
        Password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <label className="span-2">
        Authentication code
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required={action === 'disable'}
        />
      </label>
      {error && (
        <div className="span-2">
          <ErrorBanner error={error} />
        </div>
      )}
      <button className={`button ${action === 'delete' ? 'danger' : 'primary'} span-2`}>
        {action === 'delete' ? 'Permanently delete account' : 'Disable two-factor authentication'}
      </button>
    </form>
  );
}
