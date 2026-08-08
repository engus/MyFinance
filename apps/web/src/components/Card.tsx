import type { PropsWithChildren, ReactNode } from "react";

type CardProps = PropsWithChildren<{
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}>;

export function Card({ action, children, className = "", subtitle, title }: CardProps) {
  return (
    <article className={`card ${className}`.trim()}>
      {title ? (
        <header className="card-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </article>
  );
}
