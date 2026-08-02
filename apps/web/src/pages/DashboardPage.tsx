import { Link } from 'react-router-dom';

export function DashboardPage({ user }: { user: { id: string; email: string } }) {
  return (
    <div style={{ padding: 32 }}>
      <h1>Добро пожаловать, {user.email}</h1>
      <p>
        <Link to="/cashflow">Перейти к Cashflow →</Link>
      </p>
    </div>
  );
}
