import { useQuery } from "@tanstack/react-query";

import { getReadiness } from "../api/client";
import { ErrorState, LoadingState } from "../components/AsyncState";
import { Card } from "../components/Card";
import { en } from "../i18n/en";

const metrics = [
  { label: en.dashboard.netWorth, value: "—", tone: "neutral" },
  { label: en.dashboard.income, value: "—", tone: "positive" },
  { label: en.dashboard.expenses, value: "—", tone: "negative" },
  { label: en.dashboard.savingsRate, value: "—", tone: "neutral" },
] as const;

export function DashboardPage() {
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

      <section className="metric-grid" aria-label="Financial overview placeholders">
        {metrics.map((metric) => (
          <Card key={metric.label} className="metric-card">
            <span className="eyebrow">{metric.label}</span>
            <strong className={`metric-value metric-${metric.tone}`}>{metric.value}</strong>
            <span className="metric-note">{en.dashboard.pending}</span>
          </Card>
        ))}
      </section>

      <section className="dashboard-grid">
        <Card title="Net worth history" subtitle="Cash and manually valued assets · USD">
          <div className="chart-placeholder" aria-label="Empty net worth chart">
            <span>{en.dashboard.pending}</span>
          </div>
        </Card>
        <Card title="Accounts" subtitle="No active accounts">
          <div className="account-placeholder">
            <span className="account-placeholder-icon" aria-hidden="true">
              ＋
            </span>
            <p>Onboarding will create the first account and opening balance.</p>
          </div>
        </Card>
      </section>
    </div>
  );
}
