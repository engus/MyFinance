import { FormEvent, useState } from 'react';
import { Link } from '../router';
import { CurrentUser, login, verifyTwoFactor } from '../api/auth';
import { copy } from '../i18n/en';

export function LoginPage({ onAuthenticated }: { onAuthenticated: (user: CurrentUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (challenge) onAuthenticated(await verifyTwoFactor(challenge, code));
      else {
        const response = await login(email, password);
        if (response.requiresTotp) setChallenge(response.challengeToken);
        else onAuthenticated(response.user);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in');
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
          <p className="eyebrow">PRIVATE WEALTH, MADE CLEAR</p>
          <h1>Know exactly what you own and where your money goes.</h1>
          <p>A calm, double-entry view of cashflow, assets and liabilities across currencies.</p>
        </div>
        <blockquote>“Financial clarity without a second job.”</blockquote>
      </section>
      <section className="auth-panel">
        <form className="auth-form" onSubmit={submit}>
          <div>
            <p className="eyebrow">SECURE ACCESS</p>
            <h2>{challenge ? 'Two-factor authentication' : copy.auth.loginTitle}</h2>
            <p>
              {challenge
                ? 'Enter the code from your authenticator app or a recovery code.'
                : 'Your financial picture is waiting.'}
            </p>
          </div>
          {!challenge ? (
            <>
              <label>
                {copy.auth.email}
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  autoFocus
                />
              </label>
              <label>
                {copy.auth.password}
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
            </>
          ) : (
            <label>
              {copy.auth.code}
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
                required
                autoFocus
              />
            </label>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary wide" disabled={submitting}>
            {submitting ? 'Checking…' : challenge ? copy.auth.verify : copy.auth.login}
          </button>
          {!challenge && (
            <p className="auth-switch">
              {copy.auth.noAccount} <Link to="/register">Create an account</Link>
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
