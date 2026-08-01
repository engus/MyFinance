import { useState, FormEvent } from 'react';
import { login } from '../api/auth';
import '../styles/auth.css';

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>MyFinance</h1>
        <label htmlFor="login-email">
          Email
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label htmlFor="login-password">
          Пароль
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit">Войти</button>
      </form>
    </div>
  );
}
