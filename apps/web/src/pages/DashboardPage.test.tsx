import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as dashboardApi from '../api/dashboard';
import { DashboardPage } from './DashboardPage';

describe('DashboardPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it('renders consolidated multicurrency KPIs', async () => {
    vi.spyOn(dashboardApi, 'fetchDashboard').mockResolvedValue({
      currency: 'USD',
      generatedAt: '2026-08-02T00:00:00.000Z',
      kpis: {
        netWorth: '9500',
        assets: '10000',
        liabilities: '500',
        cash: '2000',
        monthlyIncome: '4000',
        monthlyExpense: '2500',
        monthlySavings: '1500',
      },
      cashflow: [],
      netWorthHistory: [],
      assetAllocation: [],
      currencyExposure: [],
      missingRates: [],
    });
    render(<DashboardPage />);
    expect((await screen.findAllByText('Net worth')).length).toBeGreaterThan(0);
    expect(screen.getByText('$9,500.00')).toBeInTheDocument();
  });
});
