import { NavLink, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../auth/useAuth";
import { en } from "../i18n/en";
import { Button } from "./Button";

const navigation = [
  { to: "/dashboard", label: en.nav.dashboard, icon: "▦" },
  { to: "/cashflow", label: en.nav.cashflow, icon: "↕" },
  { to: "/assets", label: en.nav.assets, icon: "◇" },
  { to: "/settings", label: en.nav.settings, icon: "⚙" },
] as const;

function pageTitle(pathname: string) {
  return navigation.find((item) => pathname.startsWith(item.to))?.label ?? en.app.name;
}

export function AppShell() {
  const location = useLocation();
  const { logout, user } = useAuth();
  const initials = user?.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label={en.app.name}>
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>{en.app.name}</span>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          {navigation.map((item) => (
            <NavLink key={item.to} className="nav-link" to={item.to}>
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="workspace-note">
          <strong>{en.app.privateWorkspace}</strong>
          <span>{en.app.localOnly}</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <h1>{pageTitle(location.pathname)}</h1>
          <div className="profile-actions">
            <div className="profile-copy">
              <strong>{user?.displayName}</strong>
              <span>{user?.email}</span>
            </div>
            <div className="avatar" aria-label={user?.displayName}>
              {initials}
            </div>
            <Button className="logout-button" onClick={() => void logout()}>
              {en.auth.signOut}
            </Button>
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
