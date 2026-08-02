import { ReactNode, useEffect, useState } from 'react';
import { CurrentUser, fetchCurrentUser } from './api/auth';
import { AppShell } from './components/AppShell';
import { AssetsPage } from './pages/AssetsPage';
import { CashflowPage } from './pages/CashflowPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { BrowserRouter, Redirect, usePathname } from './router';

export function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  if (loading)
    return (
      <div className="app-loading">
        <span className="brand-symbol">M</span>
        <p>Opening your private ledger…</p>
      </div>
    );
  return (
    <BrowserRouter>
      <AppRoute user={user} setUser={setUser} />
    </BrowserRouter>
  );
}

function AppRoute({
  user,
  setUser,
}: {
  user: CurrentUser | null;
  setUser: (user: CurrentUser | null) => void;
}) {
  const pathname = usePathname();
  if (pathname === '/login')
    return user ? <Redirect to="/dashboard" /> : <LoginPage onAuthenticated={setUser} />;
  if (pathname === '/register')
    return user ? <Redirect to="/onboarding" /> : <RegisterPage onAuthenticated={setUser} />;
  if (!user) return <Redirect to="/login" />;

  const pages: Record<string, ReactNode> = {
    '/onboarding': <OnboardingPage />,
    '/dashboard': <DashboardPage />,
    '/cashflow': <CashflowPage />,
    '/assets': <AssetsPage />,
    '/settings': <SettingsPage onUserChanged={setUser} />,
  };
  const page = pages[pathname];
  if (!page) return <Redirect to="/dashboard" />;
  return (
    <AppShell user={user} onLoggedOut={() => setUser(null)}>
      {page}
    </AppShell>
  );
}
