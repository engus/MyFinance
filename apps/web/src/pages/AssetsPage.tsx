import { EmptyState } from "../components/AsyncState";
import { en } from "../i18n/en";

export function AssetsPage() {
  return (
    <section className="page-stack">
      <header className="section-intro">
        <span className="eyebrow">Manual valuation history</span>
        <h2>{en.assets.title}</h2>
        <p>{en.assets.description}</p>
      </header>
      <EmptyState description={en.assets.empty} title={en.states.emptyTitle} />
    </section>
  );
}
