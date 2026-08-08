import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import {
  ApiError,
  createRecurringTemplate,
  listRecurringTemplates,
  updateRecurringTemplate,
  type Account,
  type Category,
  type CreateRecurringTemplateRequest,
  type RecurringTemplate,
} from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { en } from "../i18n/en";

type RecurringType = CreateRecurringTemplateRequest["type"];
type Frequency = CreateRecurringTemplateRequest["frequency"];
type IntervalUnit = NonNullable<CreateRecurringTemplateRequest["intervalUnit"]>;

const recurringTypes: RecurringType[] = ["INCOME", "EXPENSE", "TRANSFER", "ASSET_PURCHASE"];
const frequencies: Frequency[] = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "CUSTOM"];

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function amountLabel(value: string, currency: string) {
  return `${value.replace(/\.0+$/, "")} ${currency}`;
}

export function RecurringView({
  accounts,
  categories,
}: {
  accounts: Account[];
  categories: Category[];
}) {
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialog, setDialog] = useState<null | { template?: RecurringTemplate }>(null);
  const templatesQuery = useQuery({
    queryKey: ["recurring-templates", includeArchived],
    queryFn: () => listRecurringTemplates(includeArchived),
  });
  const updateMutation = useMutation({
    mutationFn: ({
      template,
      payload,
    }: {
      template: RecurringTemplate;
      payload: Parameters<typeof updateRecurringTemplate>[1];
    }) => updateRecurringTemplate(template.id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recurring-templates"] });
    },
  });

  if (templatesQuery.isLoading) {
    return (
      <Card>
        <LoadingState label={en.cashflow.loading} />
      </Card>
    );
  }
  if (templatesQuery.isError) {
    return (
      <Card>
        <ErrorState label={en.recurring.loadError} onRetry={() => void templatesQuery.refetch()} />
      </Card>
    );
  }
  const templates = templatesQuery.data ?? [];
  return (
    <section className="feature-stack" aria-labelledby="recurring-title">
      <header className="feature-heading">
        <div>
          <h3 id="recurring-title">{en.recurring.title}</h3>
          <p>{en.recurring.description}</p>
        </div>
        <Button variant="primary" onClick={() => setDialog({})}>
          <span aria-hidden="true">＋</span> {en.recurring.add}
        </Button>
      </header>
      <label className="archive-toggle compact-check">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(event) => setIncludeArchived(event.target.checked)}
        />
        <span>{en.recurring.includeArchived}</span>
      </label>
      {templates.length === 0 ? (
        <EmptyState title={en.states.emptyTitle} description={en.recurring.empty} />
      ) : (
        <div className="recurring-grid">
          {templates.map((template) => (
            <Card
              key={template.id}
              className={template.archived ? "template-card template-muted" : "template-card"}
            >
              <div className="template-heading">
                <div>
                  <span className={`status-pill status-${template.status.toLowerCase()}`}>
                    {template.status === "ACTIVE" ? en.recurring.active : en.recurring.paused}
                  </span>
                  <h4>{template.name}</h4>
                  <p>
                    {en.cashflow.typeLabels[template.type]} ·{" "}
                    {amountLabel(template.amount, template.currency)}
                  </p>
                </div>
                <strong>{frequencyLabel(template.frequency)}</strong>
              </div>
              <dl className="template-dates">
                <div>
                  <dt>{en.recurring.next}</dt>
                  <dd>{template.nextScheduledDate}</dd>
                </div>
                <div>
                  <dt>{en.recurring.lastPosted}</dt>
                  <dd>{template.lastGeneratedDate ?? en.recurring.neverPosted}</dd>
                </div>
              </dl>
              {template.pauseReason === "DEPENDENCY_ARCHIVED" ? (
                <p className="inline-warning">{en.recurring.dependencyPaused}</p>
              ) : null}
              {template.pauseReason === "COMPLETED" ? (
                <p className="inline-warning">{en.recurring.completed}</p>
              ) : null}
              <div className="row-actions template-actions">
                <Button onClick={() => setDialog({ template })}>{en.recurring.editAction}</Button>
                {!template.archived ? (
                  <Button
                    disabled={updateMutation.isPending}
                    onClick={() =>
                      updateMutation.mutate({
                        template,
                        payload: { status: template.status === "ACTIVE" ? "PAUSED" : "ACTIVE" },
                      })
                    }
                  >
                    {template.status === "ACTIVE" ? en.recurring.pause : en.recurring.resume}
                  </Button>
                ) : null}
                <Button
                  disabled={updateMutation.isPending}
                  onClick={() =>
                    updateMutation.mutate({ template, payload: { archived: !template.archived } })
                  }
                >
                  {template.archived ? en.recurring.restore : en.recurring.archive}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {updateMutation.isError ? (
        <div className="form-alert" role="alert">
          {updateMutation.error instanceof ApiError
            ? updateMutation.error.message
            : en.recurring.saveError}
        </div>
      ) : null}
      {dialog ? (
        <RecurringDialog
          accounts={accounts}
          categories={categories}
          existing={dialog.template}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await queryClient.invalidateQueries({ queryKey: ["recurring-templates"] });
          }}
        />
      ) : null}
    </section>
  );
}

function RecurringDialog({
  accounts,
  categories,
  existing,
  onClose,
  onSaved,
}: {
  accounts: Account[];
  categories: Category[];
  existing?: RecurringTemplate;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState<RecurringType>(existing?.type ?? "EXPENSE");
  const [amount, setAmount] = useState(existing?.amount ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [accountId, setAccountId] = useState(
    existing?.accountId ?? existing?.sourceAccountId ?? accounts[0]?.id ?? "",
  );
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [destinationId, setDestinationId] = useState(
    existing?.destinationAccountId ?? accounts[1]?.id ?? "",
  );
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? "MONTHLY");
  const [intervalCount, setIntervalCount] = useState(existing?.intervalCount ?? 1);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(
    existing?.intervalUnit ?? "MONTHS",
  );
  const [startDate, setStartDate] = useState(existing?.startDate ?? localDate());
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const transferLike = type === "TRANSFER" || type === "ASSET_PURCHASE";
  const matchingCategories = categories.filter((category) => category.direction === type);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,8})?$/.test(amount) || /^0(?:\.0+)?$/.test(amount)) {
      setError(en.cashflow.exactAmount);
      return;
    }
    if (
      !name.trim() ||
      !accountId ||
      (!transferLike && !categoryId) ||
      (transferLike && (!destinationId || destinationId === accountId))
    ) {
      setError(en.cashflow.emptyAccounts);
      return;
    }
    setSaving(true);
    try {
      if (existing) {
        await updateRecurringTemplate(existing.id, {
          name: name.trim(),
          amount,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(endDate ? { endDate } : {}),
        });
      } else {
        await createRecurringTemplate({
          name: name.trim(),
          type,
          amount,
          frequency,
          startDate,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(endDate ? { endDate } : {}),
          ...(frequency === "CUSTOM" ? { intervalCount, intervalUnit } : {}),
          ...(transferLike
            ? { sourceAccountId: accountId, destinationAccountId: destinationId }
            : { accountId, categoryId }),
        });
      }
      await onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : en.recurring.saveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="ledger-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recurring-dialog-title"
      >
        <header>
          <div>
            <span className="eyebrow">{en.recurring.title}</span>
            <h2 id="recurring-dialog-title">{existing ? en.recurring.edit : en.recurring.add}</h2>
          </div>
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            aria-label={en.recurring.close}
          >
            ×
          </button>
        </header>
        <form className="ledger-form" onSubmit={(event) => void submit(event)}>
          <label className="form-field full-field">
            <span>{en.recurring.name}</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              required
            />
          </label>
          {!existing ? (
            <label className="form-field">
              <span>{en.recurring.operation}</span>
              <select
                value={type}
                onChange={(event) => {
                  setType(event.target.value as RecurringType);
                  setCategoryId("");
                }}
              >
                {recurringTypes.map((value) => (
                  <option key={value} value={value}>
                    {en.cashflow.typeLabels[value]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="form-field">
            <span>{en.recurring.amount}</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              required
            />
          </label>
          {!existing ? (
            <>
              <label className="form-field">
                <span>{transferLike ? en.recurring.sourceAccount : en.recurring.account}</span>
                <select
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  required
                >
                  <option value="">{en.cashflow.allAccounts}</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.currency}
                    </option>
                  ))}
                </select>
              </label>
              {transferLike ? (
                <label className="form-field">
                  <span>{en.recurring.destinationAccount}</span>
                  <select
                    value={destinationId}
                    onChange={(event) => setDestinationId(event.target.value)}
                    required
                  >
                    <option value="">{en.cashflow.allAccounts}</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {account.currency}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="form-field">
                  <span>{en.recurring.category}</span>
                  <select
                    value={categoryId}
                    onChange={(event) => setCategoryId(event.target.value)}
                    required
                  >
                    <option value="">{en.cashflow.allCategories}</option>
                    {matchingCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="form-field">
                <span>{en.recurring.frequency}</span>
                <select
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value as Frequency)}
                >
                  {frequencies.map((value) => (
                    <option key={value} value={value}>
                      {frequencyLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>{en.recurring.startDate}</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  required
                />
              </label>
              {frequency === "CUSTOM" ? (
                <>
                  <label className="form-field">
                    <span>{en.recurring.intervalCount}</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={intervalCount}
                      onChange={(event) => setIntervalCount(Number(event.target.value))}
                    />
                  </label>
                  <label className="form-field">
                    <span>{en.recurring.intervalUnit}</span>
                    <select
                      value={intervalUnit}
                      onChange={(event) => setIntervalUnit(event.target.value as IntervalUnit)}
                    >
                      {(["DAYS", "WEEKS", "MONTHS", "YEARS"] as IntervalUnit[]).map((value) => (
                        <option key={value} value={value}>
                          {intervalLabel(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
            </>
          ) : null}
          <label className="form-field">
            <span>{en.recurring.endDate}</span>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <label className="form-field full-field">
            <span>{en.recurring.descriptionLabel}</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
            />
          </label>
          {error ? (
            <div className="form-alert full-field" role="alert">
              {error}
            </div>
          ) : null}
          <footer className="dialog-actions full-field">
            <Button onClick={onClose}>{en.recurring.close}</Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? en.recurring.saving : en.recurring.save}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function frequencyLabel(value: Frequency | RecurringTemplate["frequency"]) {
  return {
    WEEKLY: en.recurring.weekly,
    MONTHLY: en.recurring.monthly,
    QUARTERLY: en.recurring.quarterly,
    YEARLY: en.recurring.yearly,
    CUSTOM: en.recurring.custom,
  }[value];
}

function intervalLabel(value: IntervalUnit) {
  return {
    DAYS: en.recurring.days,
    WEEKS: en.recurring.weeks,
    MONTHS: en.recurring.months,
    YEARS: en.recurring.years,
  }[value];
}
