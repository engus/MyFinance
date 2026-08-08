import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getDashboard } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { ErrorState, LoadingState } from "../components/AsyncState";
import { Card } from "../components/Card";
import { en } from "../i18n/en";

const chartColors = ["#4f46e5", "#0f766e", "#b45309", "#be123c", "#2563eb", "#7c3aed"];

function localMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function exactDisplay(value: string, currency: string) {
  const negative = value.startsWith("-");
  const [integer = "0", fraction = ""] = value.replace("-", "").split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = fraction.replace(/0+$/, "");
  return `${negative ? "−" : ""}${grouped}${decimals ? `.${decimals}` : ""} ${currency}`;
}

export function DashboardPage() {
  const { user } = useAuth();
  const month = localMonth();
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", month],
    queryFn: () => getDashboard(month),
  });
  const dashboard = dashboardQuery.data;
  const currency = dashboard?.currency ?? user?.displayCurrency ?? "USD";

  if (dashboardQuery.isLoading) {
    return (
      <section className="page-stack">
        <Card>
          <LoadingState label={en.dashboard.loading} />
        </Card>
      </section>
    );
  }
  if (dashboardQuery.isError || !dashboard) {
    return (
      <section className="page-stack">
        <Card>
          <ErrorState
            label={en.dashboard.loadError}
            onRetry={() => void dashboardQuery.refetch()}
          />
        </Card>
      </section>
    );
  }

  const metrics = [
    {
      label: en.dashboard.netWorth,
      value: dashboard.netWorth,
      tone: "neutral",
      note: en.dashboard.asOfToday,
    },
    {
      label: en.dashboard.income,
      value: dashboard.monthlyIncome,
      tone: "positive",
      note: dashboard.month,
    },
    {
      label: en.dashboard.expenses,
      value: dashboard.monthlyExpenses,
      tone: "negative",
      note: dashboard.month,
    },
    {
      label: en.dashboard.savingsRate,
      value: dashboard.savingsRate ? `${dashboard.savingsRate}%` : "—",
      tone: "neutral",
      note: dashboard.savingsRate
        ? en.dashboard.netSavings(exactDisplay(dashboard.netSavings, currency))
        : en.dashboard.noIncome,
    },
  ] as const;
  const stale = dashboard.fxStatus.state !== "COMPLETE";

  return (
    <div className="page-stack dashboard-page">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">{en.dashboard.eyebrow}</span>
          <h2>{en.dashboard.title}</h2>
          <p>{en.dashboard.description}</p>
        </div>
        <div className="dashboard-hero-value">
          <span>{en.dashboard.netWorth}</span>
          <strong>{exactDisplay(dashboard.netWorth, currency)}</strong>
        </div>
      </section>

      {stale ? (
        <div
          className={`dashboard-fx-notice ${dashboard.fxStatus.state.toLowerCase()}`}
          role="status"
        >
          {dashboard.fxStatus.state === "INCOMPLETE"
            ? en.dashboard.incompleteFx(dashboard.fxStatus.missingCurrencies.join(", "))
            : en.dashboard.staleFx(dashboard.fxStatus.staleCurrencies.join(", "))}
        </div>
      ) : null}

      <section className="metric-grid" aria-label={en.dashboard.financialOverview}>
        {metrics.map((metric) => (
          <Card key={metric.label} className="metric-card">
            <span className="eyebrow">{metric.label}</span>
            <strong className={`metric-value metric-${metric.tone}`}>
              {metric.value.includes("%") ? metric.value : exactDisplay(metric.value, currency)}
            </strong>
            <span className="metric-note">{metric.note}</span>
          </Card>
        ))}
      </section>

      <section className="dashboard-grid dashboard-charts">
        <Card
          title={en.dashboard.netWorthHistory}
          subtitle={en.dashboard.netWorthSubtitle(currency)}
        >
          <ChartFallback
            empty={!dashboard.netWorthHistory.some((point) => point.netWorth !== "0")}
            label={en.dashboard.emptyNetWorthChart}
          >
            <ResponsiveContainer height={230} width="100%">
              <LineChart data={dashboard.netWorthHistory}>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value) => value.slice(5)}
                />
                <YAxis hide />
                <Tooltip formatter={(value) => exactDisplay(String(value), currency)} />
                <Line
                  dataKey="netWorth"
                  dot={false}
                  stroke="#4f46e5"
                  strokeWidth={2.5}
                  type="monotone"
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartFallback>
        </Card>
        <Card title={en.dashboard.cashflowHistory} subtitle={en.dashboard.cashflowSubtitle}>
          <ChartFallback
            empty={
              !dashboard.cashflowHistory.some(
                (point) => point.income !== "0" || point.expenses !== "0",
              )
            }
            label={en.dashboard.emptyCashflowChart}
          >
            <ResponsiveContainer height={230} width="100%">
              <BarChart data={dashboard.cashflowHistory}>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value) => value.slice(5)}
                />
                <YAxis hide />
                <Tooltip formatter={(value) => exactDisplay(String(value), currency)} />
                <Bar dataKey="income" fill="#0f766e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expenses" fill="#be123c" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFallback>
        </Card>
      </section>

      <section className="dashboard-grid dashboard-charts">
        <Card title={en.dashboard.assetAllocation} subtitle={en.dashboard.assetAllocationSubtitle}>
          <BreakdownChart
            data={dashboard.assetAllocation}
            currency={currency}
            empty={en.dashboard.emptyAllocation}
          />
        </Card>
        <Card
          title={en.dashboard.currencyExposure}
          subtitle={en.dashboard.currencyExposureSubtitle}
        >
          <BreakdownChart
            data={dashboard.currencyExposure}
            currency={currency}
            empty={en.dashboard.emptyExposure}
          />
        </Card>
      </section>
    </div>
  );
}

function ChartFallback({
  children,
  empty,
  label,
}: {
  children: React.ReactNode;
  empty: boolean;
  label: string;
}) {
  return empty ? (
    <div className="chart-placeholder" aria-label={label}>
      <span>{label}</span>
    </div>
  ) : (
    <>{children}</>
  );
}

function BreakdownChart({
  data,
  empty,
  currency,
}: {
  data: { label: string; value: string }[];
  empty: string;
  currency: string;
}) {
  if (!data.length)
    return (
      <div className="chart-placeholder">
        <span>{empty}</span>
      </div>
    );
  return (
    <div className="breakdown-chart">
      <ResponsiveContainer height={190} width="48%">
        <PieChart>
          <Pie
            data={data.map((item) => ({ ...item, value: Number(item.value) }))}
            dataKey="value"
            innerRadius={52}
            outerRadius={76}
            paddingAngle={3}
          >
            {data.map((item, index) => (
              <Cell fill={chartColors[index % chartColors.length]} key={item.label} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="breakdown-legend">
        {data.map((item, index) => (
          <div key={item.label}>
            <i style={{ background: chartColors[index % chartColors.length] }} />
            <span>{item.label}</span>
            <strong>{exactDisplay(item.value, currency)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
