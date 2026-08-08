import { useQuery } from "@tanstack/react-query";

import { getReadiness } from "../api/client";
import { ErrorState, LoadingState } from "../components/AsyncState";
import { Card } from "../components/Card";
import { useAuth } from "../auth/useAuth";
import { en } from "../i18n/en";

const metrics = [
  { label: en.dashboard.netWorth, value: "—", tone: "neutral" },
  { label: en.dashboard.income, value: "—", tone: "positive" },
  { label: en.dashboard.expenses, value: "—", tone: "negative" },
  { label: en.dashboard.savingsRate, value: "—", tone: "neutral" },
] as const;

export function DashboardPage() {
  const { user } = useAuth();
  const readiness = useQuery({
    queryKey: ["health", "ready"],
    queryFn: ({ signal }) => getReadiness(signal),
  });

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">{en.dashboard.eyebrow}</span>
          <h2>{en.dashboard.title}</h2>
          <p>{en.dashboard.description}</p>
        </div>
        <div className="health-panel" aria-label={en.dashboard.apiStatus}>
          <span className="eyebrow">{en.dashboard.apiStatus}</span>
          {readiness.isPending ? <LoadingState label={en.states.loading} /> : null}
          {readiness.isError ? (
            <ErrorState label={en.states.unavailable} onRetry={() => void readiness.refetch()} />
          ) : null}
          {readiness.data ? (
            <div className="inline-state">
              <span className="status-dot status-dot-ready" aria-hidden="true" />
              <strong>{en.states.ready}</strong>
              <span className="muted">v{readiness.data.version}</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="metric-grid" aria-label={en.dashboard.financialOverview}>
        {metrics.map((metric) => (
          <Card key={metric.label} className="metric-card">
            <span className="eyebrow">{metric.label}</span>
            <strong className={`metric-value metric-${metric.tone}`}>{metric.value}</strong>
            <span className="metric-note">{en.dashboard.pending}</span>
          </Card>
        ))}
      </section>

      <section className="dashboard-grid">
        <Card
          title={en.dashboard.netWorthHistory}
          subtitle={en.dashboard.netWorthSubtitle(user?.displayCurrency ?? "USD")}
        >
          <div className="chart-placeholder" aria-label={en.dashboard.emptyNetWorthChart}>
            <span>{en.dashboard.pending}</span>
          </div>
        </Card>
        <Card title={en.dashboard.accounts} subtitle={en.dashboard.stagedAccounts}>
          <div className="account-placeholder">
            <span className="account-placeholder-icon" aria-hidden="true">
              ＋
            </span>
            <p>{en.dashboard.stagedAccountDescription}</p>
          </div>
        </Card>
      </section>
    </div>
  );
}
