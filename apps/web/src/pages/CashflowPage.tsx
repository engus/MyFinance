import { EmptyState } from "../components/AsyncState";
import { en } from "../i18n/en";

export function CashflowPage() {
  return (
    <section className="page-stack">
      <header className="section-intro">
        <span className="eyebrow">Operations and reconciliation</span>
        <h2>{en.cashflow.title}</h2>
        <p>{en.cashflow.description}</p>
      </header>
      <EmptyState description={en.cashflow.empty} title={en.states.emptyTitle} />
    </section>
  );
}
