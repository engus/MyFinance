import { Card } from "../components/Card";
import { en } from "../i18n/en";

const settings = [
  { label: en.settings.environment, value: "Local development" },
  { label: en.settings.version, value: "0.1.0" },
  { label: en.settings.functionalCurrency, value: "Set during onboarding" },
  { label: en.settings.timezone, value: "Set during onboarding" },
] as const;

export function SettingsPage() {
  return (
    <section className="page-stack">
      <header className="section-intro">
        <span className="eyebrow">Preferences and security</span>
        <h2>{en.settings.title}</h2>
        <p>{en.settings.description}</p>
      </header>
      <Card title="Foundation configuration" subtitle="Read-only until identity is implemented">
        <dl className="settings-list">
          {settings.map((setting) => (
            <div key={setting.label}>
              <dt>{setting.label}</dt>
              <dd>{setting.value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}
