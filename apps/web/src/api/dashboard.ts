import { apiFetch } from './client';

export interface DashboardData {
  currency: string;
  generatedAt: string;
  kpis: Record<string, string | null>;
  cashflow: Array<{
    month: string;
    income: string | null;
    expense: string | null;
    savings: string | null;
  }>;
  netWorthHistory: Array<{ month: string; value: string | null }>;
  assetAllocation: Array<{ label: string; value: string }>;
  currencyExposure: Array<{ currency: string; value: string }>;
  missingRates: string[];
}

export const fetchDashboard = () => apiFetch<DashboardData>('/dashboard');
