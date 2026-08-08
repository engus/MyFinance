import { Button } from "./Button";

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="inline-state" role="status">
      <span className="status-dot status-dot-loading" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="inline-state" role="alert">
      <span className="status-dot status-dot-error" aria-hidden="true" />
      <span>{label}</span>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}

export function EmptyState({ description, title }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        ◇
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
