import { useEffect, useState } from 'react';
import { DashboardData, fetchDashboard } from '../api/dashboard';
import { ErrorBanner, Skeleton } from '../components/AsyncState';
import { Money } from '../components/Money';

function BarPair({ income, expense }: { income: string | null; expense: string | null }) {
  const max = Math.max(Number(income ?? 0), Number(expense ?? 0), 1);
  return (
    <div className="bar-pair">
      <i
        className="bar income"
        style={{ height: `${Math.max(3, (Number(income ?? 0) / max) * 52)}px` }}
      />
      <i
        className="bar expense"
        style={{ height: `${Math.max(3, (Number(expense ?? 0) / max) * 52)}px` }}
      />
    </div>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    fetchDashboard()
      .then(setData)
      .catch((caught) => setError(caught.message));
  };
  useEffect(load, []);
  if (error)
    return (
      <div className="page">
        <ErrorBanner error={error} onRetry={load} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Skeleton rows={6} />
      </div>
    );
  const kpis = [
    ['Net worth', data.kpis.netWorth, 'primary'],
    ['Total assets', data.kpis.assets, ''],
    ['Liabilities', data.kpis.liabilities, ''],
    ['Cash', data.kpis.cash, ''],
    ['Monthly income', data.kpis.monthlyIncome, ''],
    ['Monthly expenses', data.kpis.monthlyExpense, ''],
    ['Monthly savings', data.kpis.monthlySavings, ''],
  ];
  return (
    <div className="page dashboard-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">FINANCIAL POSITION</p>
          <h1>Overview</h1>
          <p>A current view of your private balance sheet.</p>
        </div>
        <div className="as-of">
          As of{' '}
          {new Date(data.generatedAt).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
          <strong>{data.currency}</strong>
        </div>
      </header>
      {data.missingRates.length > 0 && (
        <div className="alert alert-warning">
          Manual rates required: {data.missingRates.join(', ')}
        </div>
      )}
      <section className="kpi-grid">
        {kpis.map(([label, value, tone]) => (
          <article className={`kpi-card ${tone}`} key={label}>
            <span>{label}</span>
            <strong>
              <Money value={value} currency={data.currency} />
            </strong>
          </article>
        ))}
      </section>
      <section className="dashboard-grid">
        <article className="panel chart-panel span-2">
          <header>
            <div>
              <p className="eyebrow">TRAJECTORY</p>
              <h2>Net worth</h2>
            </div>
          </header>
          <div className="spark-columns">
            {data.netWorthHistory.map((point) => {
              const values = data.netWorthHistory.map((entry) =>
                Math.abs(Number(entry.value ?? 0))
              );
              const max = Math.max(...values, 1);
              return (
                <div key={point.month} className="spark-column">
                  <i
                    style={{
                      height: `${Math.max(4, (Math.abs(Number(point.value ?? 0)) / max) * 150)}px`,
                    }}
                  />
                  <small>{point.month.slice(5)}</small>
                </div>
              );
            })}
          </div>
        </article>
        <article className="panel">
          <header>
            <p className="eyebrow">THIS MONTH</p>
            <h2>Cashflow</h2>
          </header>
          <div className="cashflow-summary">
            <div>
              <span>Income</span>
              <strong className="money-positive">
                <Money value={data.kpis.monthlyIncome} currency={data.currency} />
              </strong>
            </div>
            <div>
              <span>Expenses</span>
              <strong>
                <Money value={data.kpis.monthlyExpense} currency={data.currency} />
              </strong>
            </div>
            <div className="savings">
              <span>Savings</span>
              <strong>
                <Money value={data.kpis.monthlySavings} currency={data.currency} signed />
              </strong>
            </div>
          </div>
        </article>
        <article className="panel span-2">
          <header>
            <p className="eyebrow">12 MONTHS</p>
            <h2>Income and expenses</h2>
          </header>
          <div className="bar-chart">
            {data.cashflow.map((month) => (
              <div className="bar-month" key={month.month}>
                <BarPair income={month.income} expense={month.expense} />
                <small>{month.month.slice(5)}</small>
              </div>
            ))}
          </div>
          <div className="legend">
            <span>
              <i className="dot income" />
              Income
            </span>
            <span>
              <i className="dot expense" />
              Expenses
            </span>
          </div>
        </article>
        <article className="panel">
          <header>
            <p className="eyebrow">ALLOCATION</p>
            <h2>Assets</h2>
          </header>
          <div className="allocation-list">
            {data.assetAllocation.length ? (
              data.assetAllocation.map((row) => (
                <div key={row.label}>
                  <span>{row.label.replaceAll('_', ' ').toLowerCase()}</span>
                  <strong>
                    <Money value={row.value} currency={data.currency} />
                  </strong>
                </div>
              ))
            ) : (
              <p>No assets yet.</p>
            )}
          </div>
        </article>
        <article className="panel">
          <header>
            <p className="eyebrow">EXPOSURE</p>
            <h2>Currencies</h2>
          </header>
          <div className="allocation-list">
            {data.currencyExposure.length ? (
              data.currencyExposure.map((row) => (
                <div key={row.currency}>
                  <span>{row.currency}</span>
                  <strong>
                    <Money value={row.value} currency={data.currency} />
                  </strong>
                </div>
              ))
            ) : (
              <p>No currency exposure yet.</p>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
