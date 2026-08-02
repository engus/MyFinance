import { ReactNode } from 'react';
import { NavLink, useNavigate } from '../router';
import { CurrentUser, logout } from '../api/auth';
import { copy } from '../i18n/en';

const navItems = [
  { to: '/dashboard', label: copy.nav.dashboard, icon: '⌂' },
  { to: '/cashflow', label: copy.nav.cashflow, icon: '↕' },
  { to: '/assets', label: copy.nav.assets, icon: '◇' },
  { to: '/settings', label: copy.nav.settings, icon: '⚙' },
];

export function AppShell({
  user,
  onLoggedOut,
  children,
}: {
  user: CurrentUser;
  onLoggedOut: () => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  async function handleLogout() {
    await logout();
    onLoggedOut();
    navigate('/login');
  }
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-mark">
          <span>M</span>
          <strong>{copy.brand}</strong>
        </div>
        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{user.email[0]?.toUpperCase()}</span>
          <div>
            <strong>{user.email}</strong>
            <button onClick={handleLogout}>Sign out</button>
          </div>
        </div>
      </aside>
      <main className="app-main">{children}</main>
      <nav className="mobile-nav">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to}>
            <span>{item.icon}</span>
            <small>{item.label.split(' ')[0]}</small>
          </NavLink>
        ))}
        <button onClick={handleLogout}>
          <span>⇥</span>
          <small>Sign out</small>
        </button>
      </nav>
    </div>
  );
}
