export function formatMoney(value: string | number | null | undefined, currency: string) {
  if (value === null || value === undefined) return '—';
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currency}`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function Money({
  value,
  currency,
  signed = false,
}: {
  value: string | number | null | undefined;
  currency: string;
  signed?: boolean;
}) {
  const numeric = Number(value ?? 0);
  return (
    <span className={signed ? (numeric >= 0 ? 'money-positive' : 'money-negative') : undefined}>
      {formatMoney(value, currency)}
    </span>
  );
}
