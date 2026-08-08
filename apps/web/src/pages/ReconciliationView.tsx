import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import {
  ApiError,
  confirmReconciliation,
  getReconciliationStatus,
  prepareReconciliation,
  type AccountReconciliationStatus,
  type ReconciliationPreview,
} from "../api/client";
import { ErrorState, LoadingState } from "../components/AsyncState";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { en } from "../i18n/en";

function monthEnd(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0));
  return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, "0")}-${String(last.getUTCDate()).padStart(2, "0")}`;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function amountLabel(value: string, currency: string) {
  return `${value.replace(/\.0+$/, "")} ${currency}`;
}

export function ReconciliationView() {
  const queryClient = useQueryClient();
  const [periodEnd, setPeriodEnd] = useState("");
  const [dialogAccount, setDialogAccount] = useState<AccountReconciliationStatus | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const statusQuery = useQuery({
    queryKey: ["reconciliation-status", periodEnd || "suggested"],
    queryFn: () => getReconciliationStatus(periodEnd || undefined),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["reconciliation-status"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger-accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger-transactions"] }),
    ]);
  };

  if (statusQuery.isLoading) {
    return (
      <Card>
        <LoadingState label={en.cashflow.loading} />
      </Card>
    );
  }
  if (statusQuery.isError || !statusQuery.data) {
    return (
      <Card>
        <ErrorState
          label={en.reconciliation.loadError}
          onRetry={() => void statusQuery.refetch()}
        />
      </Card>
    );
  }
  const status = statusQuery.data;
  return (
    <section className="feature-stack" aria-labelledby="reconciliation-title">
      <header className="feature-heading reconciliation-heading">
        <div>
          <h3 id="reconciliation-title">{en.reconciliation.title}</h3>
          <p>{en.reconciliation.description}</p>
        </div>
        <label className="compact-field month-picker">
          <span>{en.reconciliation.period}</span>
          <input
            type="month"
            max={currentMonth()}
            value={(periodEnd || status.periodEnd).slice(0, 7)}
            onChange={(event) => setPeriodEnd(monthEnd(event.target.value))}
          />
        </label>
      </header>
      <Card className={status.complete ? "period-status period-complete" : "period-status"}>
        <div>
          <span className="eyebrow">{status.periodEnd}</span>
          <strong>
            {status.complete ? en.reconciliation.complete : en.reconciliation.incomplete}
          </strong>
          <p>
            {status.promptOpen ? en.reconciliation.windowOpen : en.reconciliation.availableAnytime}
          </p>
        </div>
        <span className="period-count">
          {status.accounts.filter((account) => account.status === "RECONCILED").length}/
          {status.accounts.length}
        </span>
      </Card>
      {success ? (
        <div className="form-success" role="status">
          {success}
        </div>
      ) : null}
      <div className="reconciliation-grid">
        {status.accounts.map((account) => (
          <Card key={account.accountId} className="reconciliation-account-card">
            <div className="reconciliation-account-heading">
              <div>
                <span className={`status-pill status-${account.status.toLowerCase()}`}>
                  {account.status === "RECONCILED"
                    ? en.reconciliation.reconciled
                    : en.reconciliation.pending}
                </span>
                <h4>{account.accountName}</h4>
              </div>
              <strong>{amountLabel(account.ledgerBalance, account.currency)}</strong>
            </div>
            <dl className="reconciliation-values">
              <div>
                <dt>{en.reconciliation.ledgerBalance}</dt>
                <dd>{amountLabel(account.ledgerBalance, account.currency)}</dd>
              </div>
              <div>
                <dt>{en.reconciliation.reportedBalance}</dt>
                <dd>
                  {account.reportedBalance
                    ? amountLabel(account.reportedBalance, account.currency)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{en.reconciliation.difference}</dt>
                <dd>
                  {account.difference ? amountLabel(account.difference, account.currency) : "—"}
                </dd>
              </div>
            </dl>
            {account.multiMonthGap ? (
              <p className="inline-warning">
                {en.reconciliation.multiMonthWarning(account.gapMonths)}
              </p>
            ) : null}
            <Button
              variant="primary"
              onClick={() => {
                setSuccess(null);
                setDialogAccount(account);
              }}
            >
              {account.status === "RECONCILED"
                ? en.reconciliation.updateAgain
                : en.reconciliation.update}
            </Button>
          </Card>
        ))}
      </div>
      {dialogAccount ? (
        <ReconciliationDialog
          account={dialogAccount}
          periodEnd={status.periodEnd}
          onClose={() => setDialogAccount(null)}
          onApplied={async () => {
            setDialogAccount(null);
            setSuccess(en.reconciliation.applied);
            await refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function ReconciliationDialog({
  account,
  periodEnd,
  onClose,
  onApplied,
}: {
  account: AccountReconciliationStatus;
  periodEnd: string;
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const [reported, setReported] = useState(account.reportedBalance ?? "");
  const [preview, setPreview] = useState<ReconciliationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function prepare(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,8})?$/.test(reported)) {
      setError(en.reconciliation.exactBalance);
      return;
    }
    setSubmitting(true);
    try {
      const response = await prepareReconciliation({
        accountId: account.accountId,
        periodEnd,
        reportedBalance: reported,
        idempotencyKey: crypto.randomUUID(),
      });
      if (response.outcome === "APPLIED") {
        await onApplied();
      } else if (response.preview) {
        setPreview(response.preview);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : en.reconciliation.saveError);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setSubmitting(true);
    setError(null);
    try {
      await confirmReconciliation(preview.id);
      await onApplied();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : en.reconciliation.saveError);
    } finally {
      setSubmitting(false);
    }
  }

  const direction = preview
    ? preview.direction === "OTHER_INCOME"
      ? en.reconciliation.otherIncome
      : preview.direction === "OTHER_EXPENSE"
        ? en.reconciliation.otherExpense
        : en.reconciliation.noAdjustment
    : "";
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="ledger-dialog reconciliation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reconciliation-dialog-title"
      >
        <header>
          <div>
            <span className="eyebrow">
              {account.accountName} · {periodEnd}
            </span>
            <h2 id="reconciliation-dialog-title">{en.reconciliation.dialogTitle}</h2>
          </div>
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            aria-label={en.reconciliation.close}
          >
            ×
          </button>
        </header>
        <form className="ledger-form" onSubmit={(event) => void prepare(event)}>
          <div className="dialog-note full-field">
            {en.reconciliation.ledgerBalance}:{" "}
            <strong>{amountLabel(account.ledgerBalance, account.currency)}</strong>
          </div>
          <label className="form-field full-field">
            <span>{en.reconciliation.balanceLabel}</span>
            <input
              autoFocus
              inputMode="decimal"
              value={reported}
              onChange={(event) => {
                setReported(event.target.value);
                setPreview(null);
              }}
              placeholder="0.00"
              required
            />
          </label>
          {preview ? (
            <section className="reconciliation-preview full-field" aria-labelledby="preview-title">
              <span className="eyebrow" id="preview-title">
                {en.reconciliation.previewTitle}
              </span>
              <strong>
                {en.reconciliation.previewExplanation(
                  direction,
                  preview.difference.replace("-", ""),
                  preview.currency,
                )}
              </strong>
              <dl className="reconciliation-values">
                <div>
                  <dt>{en.reconciliation.ledgerBalance}</dt>
                  <dd>{amountLabel(preview.ledgerBalance, preview.currency)}</dd>
                </div>
                <div>
                  <dt>{en.reconciliation.reportedBalance}</dt>
                  <dd>{amountLabel(preview.reportedBalance, preview.currency)}</dd>
                </div>
              </dl>
              {preview.multiMonthGap ? (
                <p className="inline-warning">
                  {en.reconciliation.multiMonthWarning(preview.gapMonths)}
                </p>
              ) : null}
            </section>
          ) : null}
          {error ? (
            <div className="form-alert full-field" role="alert">
              {error}
            </div>
          ) : null}
          <footer className="dialog-actions full-field">
            <Button onClick={onClose}>{en.reconciliation.close}</Button>
            {preview ? (
              <Button variant="primary" onClick={() => void confirm()} disabled={submitting}>
                {submitting ? en.reconciliation.confirming : en.reconciliation.confirm}
              </Button>
            ) : (
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? en.reconciliation.preparing : en.reconciliation.prepare}
              </Button>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}
