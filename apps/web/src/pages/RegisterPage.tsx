import { FormEvent, useState } from 'react';
import { Link } from '../router';
import { CurrentUser, register } from '../api/auth';
import { copy } from '../i18n/en';

export function RegisterPage({
  onAuthenticated,
}: {
  onAuthenticated: (user: CurrentUser) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      onAuthenticated(
        await register({ email, password, functionalCurrency: 'USD', timezone: 'UTC' })
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create account');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <div className="brand-mark light">
          <span>M</span>
          <strong>MyFinance</strong>
        </div>
        <div>
          <p className="eyebrow">ONE PRIVATE LEDGER</p>
          <h1>Bring cash, property, investments and debt into one view.</h1>
          <p>Start with one account. The ledger keeps every movement balanced from day one.</p>
        </div>
        <div className="trust-row">
          <span>● Encrypted sessions</span>
          <span>● Double-entry core</span>
        </div>
      </section>
      <section className="auth-panel">
        <form className="auth-form" onSubmit={submit}>
          <div>
            <p className="eyebrow">GET STARTED</p>
            <h2>{copy.auth.registerTitle}</h2>
            <p>No bank connection required. Reporting preferences come next.</p>
          </div>
          <label>
            {copy.auth.email}
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            {copy.auth.password}
            <input
              type="password"
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <small>At least 12 characters</small>
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary wide" disabled={submitting}>
            {submitting ? 'Creating…' : copy.auth.register}
          </button>
          <p className="auth-switch">
            {copy.auth.hasAccount} <Link to="/login">Sign in</Link>
          </p>
        </form>
      </section>
    </div>
  );
}
