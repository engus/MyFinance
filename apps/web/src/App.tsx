import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { AssetsPage } from "./pages/AssetsPage";
import { CashflowPage } from "./pages/CashflowPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate replace to="/dashboard" />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="cashflow" element={<CashflowPage />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate replace to="/dashboard" />} />
    </Routes>
  );
}
