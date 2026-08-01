import { useState, FormEvent } from 'react';
import { register } from '../api/auth';
import '../styles/auth.css';

export function RegisterPage({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register(email, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>MyFinance</h1>
        <label htmlFor="register-email">
          Email
          <input
            id="register-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label htmlFor="register-password">
          Пароль
          <input
            id="register-password"
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit">Зарегистрироваться</button>
      </form>
    </div>
  );
}
