import { Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth/AuthContext";
import { PublicOnly, RequireAuth } from "./auth/AuthRoutes";
import { AppShell } from "./components/AppShell";
import { AssetsPage } from "./pages/AssetsPage";
import { CashflowPage } from "./pages/CashflowPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<PublicOnly />}>
          <Route path="login" element={<LoginPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate replace to="/dashboard" />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="cashflow" element={<CashflowPage />} />
            <Route path="assets" element={<AssetsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate replace to="/dashboard" />} />
      </Routes>
    </AuthProvider>
  );
}
