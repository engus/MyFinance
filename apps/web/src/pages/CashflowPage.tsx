import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";

import {
  ApiError,
  createAccount,
  createCategory,
  createTransaction,
  listAccounts,
  listCategories,
  listTransactions,
  replaceTransaction,
  reverseTransaction,
  updateAccount,
  updateCategory,
  type Account,
  type Category,
  type CreateTransactionRequest,
  type Transaction,
  type TransactionFilters,
} from "../api/client";
import { Button } from "../components/Button";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { Card } from "../components/Card";
import { supportedCurrencies } from "../financial-options";
import { en } from "../i18n/en";

type CashflowTab = "transactions" | "management";
type OperationType = CreateTransactionRequest["type"];

const operationTypes: OperationType[] = [
  "INCOME",
  "EXPENSE",
  "TRANSFER",
  "ASSET_PURCHASE",
  "OPENING_BALANCE",
];

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function exactDisplay(value: string, currency: string) {
  const negative = value.startsWith("-");
  const [integer = "0", fraction = ""] = value.replace("-", "").split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = fraction.replace(/0+$/, "");
  return `${negative ? "−" : ""}${grouped}${decimals ? `.${decimals}` : ""} ${currency}`;
}

function operationLabel(type: Transaction["type"] | OperationType) {
  return en.cashflow.typeLabels[type];
}

export function CashflowPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<CashflowTab>("transactions");
  const [operationModal, setOperationModal] = useState<null | { transaction?: Transaction }>(null);
  const [filters, setFilters] = useState<TransactionFilters>({});
  const [includeArchived, setIncludeArchived] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ["ledger-accounts", includeArchived],
    queryFn: () => listAccounts(includeArchived),
  });
  const categoriesQuery = useQuery({
    queryKey: ["ledger-categories", includeArchived],
    queryFn: () => listCategories(includeArchived),
  });
  const transactionsQuery = useInfiniteQuery({
    queryKey: ["ledger-transactions", filters],
    queryFn: ({ pageParam }) => listTransactions({ ...filters, cursor: pageParam, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
  });

  const accounts = accountsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const activeAccounts = accounts.filter((account) => !account.archived);
  const activeCategories = categories.filter((category) => !category.archived);
  const transactions = transactionsQuery.data?.pages.flatMap((page) => page.transactions) ?? [];

  const refreshLedger = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ledger-accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger-categories"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger-transactions"] }),
    ]);
  };

  const reverseMutation = useMutation({
    mutationFn: (transaction: Transaction) =>
      reverseTransaction(
        transaction.id,
        `Reverse: ${transaction.description ?? operationLabel(transaction.type)}`,
      ),
    onSuccess: refreshLedger,
  });

  function requestReversal(transaction: Transaction) {
    if (window.confirm(en.cashflow.confirmReverse)) reverseMutation.mutate(transaction);
  }

  const loading =
    accountsQuery.isLoading || categoriesQuery.isLoading || transactionsQuery.isLoading;
  const failed = accountsQuery.isError || categoriesQuery.isError || transactionsQuery.isError;

  return (
    <section className="page-stack cashflow-page">
      <header className="cashflow-hero">
        <div>
          <span className="eyebrow">{en.cashflow.eyebrow}</span>
          <h2>{en.cashflow.title}</h2>
          <p>{en.cashflow.description}</p>
        </div>
        <Button
          variant="primary"
          onClick={() => setOperationModal({})}
          disabled={activeAccounts.length === 0}
        >
          <span aria-hidden="true">＋</span> {en.cashflow.newOperation}
        </Button>
      </header>

      <div className="cashflow-account-strip" aria-label={en.cashflow.availableAccounts}>
        {activeAccounts.map((account) => (
          <article className="balance-chip" key={account.id}>
            <div>
              <span>{account.name}</span>
              <small>{account.subtype.replace("_", " ")}</small>
            </div>
            <strong>{exactDisplay(account.balance, account.currency)}</strong>
          </article>
        ))}
      </div>

      <nav className="segmented-tabs" aria-label={en.cashflow.title}>
        <button
          className={tab === "transactions" ? "active" : ""}
          onClick={() => setTab("transactions")}
          type="button"
        >
          {en.cashflow.transactions}
        </button>
        <button
          className={tab === "management" ? "active" : ""}
          onClick={() => setTab("management")}
          type="button"
        >
          {en.cashflow.accountsAndCategories}
        </button>
      </nav>

      {loading ? (
        <Card>
          <LoadingState label={en.cashflow.loading} />
        </Card>
      ) : null}
      {failed ? (
        <Card>
          <ErrorState label={en.cashflow.fetchError} onRetry={() => void refreshLedger()} />
        </Card>
      ) : null}

      {!loading && !failed && tab === "transactions" ? (
        <TransactionsView
          accounts={activeAccounts}
          categories={activeCategories}
          filters={filters}
          loadingMore={transactionsQuery.isFetchingNextPage}
          onClearFilters={() => setFilters({})}
          onEdit={(transaction) => setOperationModal({ transaction })}
          onFilters={setFilters}
          onLoadMore={() => void transactionsQuery.fetchNextPage()}
          onReverse={requestReversal}
          reversePending={reverseMutation.isPending}
          transactions={transactions}
          hasMore={transactionsQuery.hasNextPage}
        />
      ) : null}

      {!loading && !failed && tab === "management" ? (
        <ManagementView
          accounts={accounts}
          categories={categories}
          includeArchived={includeArchived}
          onIncludeArchived={setIncludeArchived}
          onRefresh={refreshLedger}
        />
      ) : null}

      {operationModal ? (
        <OperationDialog
          accounts={activeAccounts}
          categories={activeCategories}
          existing={operationModal.transaction}
          onClose={() => setOperationModal(null)}
          onSaved={async () => {
            setOperationModal(null);
            await refreshLedger();
          }}
        />
      ) : null}
    </section>
  );
}

function TransactionsView({
  accounts,
  categories,
  filters,
  hasMore,
  loadingMore,
  onClearFilters,
  onEdit,
  onFilters,
  onLoadMore,
  onReverse,
  reversePending,
  transactions,
}: {
  accounts: Account[];
  categories: Category[];
  filters: TransactionFilters;
  hasMore: boolean;
  loadingMore: boolean;
  onClearFilters: () => void;
  onEdit: (transaction: Transaction) => void;
  onFilters: (filters: TransactionFilters) => void;
  onLoadMore: () => void;
  onReverse: (transaction: Transaction) => void;
  reversePending: boolean;
  transactions: Transaction[];
}) {
  return (
    <>
      <Card className="filter-card">
        <div className="filter-heading">
          <strong>{en.cashflow.filters}</strong>
          <button className="text-button" onClick={onClearFilters} type="button">
            {en.cashflow.clearFilters}
          </button>
        </div>
        <div className="cashflow-filters">
          <label className="compact-field">
            <span>{en.cashflow.from}</span>
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(event) => onFilters({ ...filters, from: event.target.value || undefined })}
            />
          </label>
          <label className="compact-field">
            <span>{en.cashflow.to}</span>
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(event) => onFilters({ ...filters, to: event.target.value || undefined })}
            />
          </label>
          <label className="compact-field">
            <span>{en.cashflow.account}</span>
            <select
              value={filters.accountId ?? ""}
              onChange={(event) =>
                onFilters({ ...filters, accountId: event.target.value || undefined })
              }
            >
              <option value="">{en.cashflow.allAccounts}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-field">
            <span>{en.cashflow.category}</span>
            <select
              value={filters.categoryId ?? ""}
              onChange={(event) =>
                onFilters({ ...filters, categoryId: event.target.value || undefined })
              }
            >
              <option value="">{en.cashflow.allCategories}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-field">
            <span>{en.cashflow.operation}</span>
            <select
              value={filters.type ?? ""}
              onChange={(event) =>
                onFilters({
                  ...filters,
                  type: (event.target.value || undefined) as TransactionFilters["type"],
                })
              }
            >
              <option value="">{en.cashflow.allTypes}</option>
              {operationTypes.map((type) => (
                <option key={type} value={type}>
                  {operationLabel(type)}
                </option>
              ))}
              <option value="REVERSAL">{en.cashflow.reversal}</option>
            </select>
          </label>
        </div>
      </Card>

      {transactions.length === 0 ? (
        <EmptyState title={en.states.emptyTitle} description={en.cashflow.empty} />
      ) : (
        <Card className="transaction-card">
          <div className="transaction-list" role="table" aria-label={en.cashflow.transactions}>
            <div className="transaction-row transaction-head" role="row">
              <span role="columnheader">{en.cashflow.date}</span>
              <span role="columnheader">{en.cashflow.operation}</span>
              <span role="columnheader">{en.cashflow.account}</span>
              <span role="columnheader">{en.cashflow.amount}</span>
              <span aria-hidden="true" />
            </div>
            {transactions.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                onEdit={onEdit}
                onReverse={onReverse}
                disabled={reversePending}
              />
            ))}
          </div>
          {hasMore ? (
            <Button className="load-more" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? en.cashflow.loading : en.cashflow.loadMore}
            </Button>
          ) : null}
        </Card>
      )}
    </>
  );
}

function TransactionRow({
  disabled,
  onEdit,
  onReverse,
  transaction,
}: {
  disabled: boolean;
  onEdit: (transaction: Transaction) => void;
  onReverse: (transaction: Transaction) => void;
  transaction: Transaction;
}) {
  const immutable = transaction.type === "REVERSAL" || transaction.status !== "POSTED";
  const negative = transaction.type === "EXPENSE" || transaction.type === "ASSET_PURCHASE";
  const statusLabel = {
    POSTED: en.cashflow.posted,
    REVERSED: en.cashflow.reversed,
    REVERSAL: en.cashflow.reversal,
    REPLACED: en.cashflow.replaced,
  }[transaction.status];
  return (
    <div
      className={`transaction-row ${transaction.status !== "POSTED" ? "transaction-muted" : ""}`}
      role="row"
    >
      <time role="cell" dateTime={transaction.eventDate}>
        {transaction.eventDate}
      </time>
      <div className="operation-cell" role="cell">
        <span
          className={`operation-icon operation-${transaction.type.toLowerCase()}`}
          aria-hidden="true"
        >
          {transaction.type === "INCOME" ? "↓" : transaction.type === "EXPENSE" ? "↑" : "↔"}
        </span>
        <div>
          <strong>{transaction.description ?? operationLabel(transaction.type)}</strong>
          <small>
            {operationLabel(transaction.type)} · {statusLabel}
          </small>
        </div>
      </div>
      <div className="account-cell" role="cell">
        <strong>{transaction.primaryAccountName}</strong>
        <small>
          {transaction.counterpartyName ?? transaction.categoryName ?? en.cashflow.noDescription}
        </small>
      </div>
      <strong
        className={
          negative ? "amount-negative" : transaction.type === "INCOME" ? "amount-positive" : ""
        }
        role="cell"
      >
        {negative ? "−" : transaction.type === "INCOME" ? "+" : ""}
        {exactDisplay(transaction.amount, transaction.currency)}
      </strong>
      <div className="row-actions" role="cell">
        <Button onClick={() => onEdit(transaction)} disabled={immutable || disabled}>
          {en.cashflow.edit}
        </Button>
        <Button onClick={() => onReverse(transaction)} disabled={immutable || disabled}>
          {en.cashflow.remove}
        </Button>
      </div>
    </div>
  );
}

function OperationDialog({
  accounts,
  categories,
  existing,
  onClose,
  onSaved,
}: {
  accounts: Account[];
  categories: Category[];
  existing?: Transaction;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const startingType = existing && existing.type !== "REVERSAL" ? existing.type : "EXPENSE";
  const [type, setType] = useState<OperationType>(startingType as OperationType);
  const [date, setDate] = useState(existing?.eventDate ?? localDate());
  const [amount, setAmount] = useState(existing?.amount ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [accountId, setAccountId] = useState(existing?.primaryAccountId ?? accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [destinationId, setDestinationId] = useState(
    existing?.counterpartyAccountId ?? accounts[1]?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const matchingCategories = categories.filter((category) => category.direction === type);
  const sourceAccount = accounts.find((account) => account.id === accountId);
  const destinationAccount = accounts.find((account) => account.id === destinationId);
  const transferLike = type === "TRANSFER" || type === "ASSET_PURCHASE";
  const categoryOperation = type === "INCOME" || type === "EXPENSE";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,8})?$/.test(amount) || /^0(?:\.0+)?$/.test(amount)) {
      setError(en.cashflow.exactAmount);
      return;
    }
    if (transferLike && accountId === destinationId) {
      setError(en.cashflow.distinctAccounts);
      return;
    }
    if (transferLike && sourceAccount?.currency !== destinationAccount?.currency) {
      setError(en.cashflow.sameCurrencyOnly);
      return;
    }
    if (!accountId || (categoryOperation && !categoryId) || (transferLike && !destinationId)) {
      setError(en.cashflow.emptyAccounts);
      return;
    }
    const operation: CreateTransactionRequest = {
      type,
      eventDate: date,
      amount,
      idempotencyKey: crypto.randomUUID(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(transferLike
        ? { sourceAccountId: accountId, destinationAccountId: destinationId }
        : { accountId }),
      ...(categoryOperation ? { categoryId } : {}),
    };
    setSubmitting(true);
    try {
      if (existing) await replaceTransaction(existing.id, operation);
      else await createTransaction(operation);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : en.cashflow.operationFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="ledger-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-dialog-title"
      >
        <header>
          <div>
            <span className="eyebrow">
              {existing ? en.cashflow.edit : en.cashflow.newOperation}
            </span>
            <h2 id="operation-dialog-title">
              {existing ? en.cashflow.saveCorrection : en.cashflow.saveOperation}
            </h2>
          </div>
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            aria-label={en.cashflow.close}
          >
            ×
          </button>
        </header>
        <form className="ledger-form" onSubmit={(event) => void submit(event)}>
          <label className="form-field full-field">
            <span>{en.cashflow.operation}</span>
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value as OperationType);
                setCategoryId("");
              }}
            >
              {operationTypes.map((operationType) => (
                <option key={operationType} value={operationType}>
                  {operationLabel(operationType)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{en.cashflow.date}</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>
          <label className="form-field">
            <span>{en.cashflow.amount}</span>
            <input
              autoFocus
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              required
            />
          </label>
          <label className="form-field">
            <span>{transferLike ? en.cashflow.sourceAccount : en.cashflow.account}</span>
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
              <span>{en.cashflow.destinationAccount}</span>
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
          ) : null}
          {categoryOperation ? (
            <label className="form-field">
              <span>{en.cashflow.category}</span>
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
          ) : null}
          <label className="form-field full-field">
            <span>{en.cashflow.descriptionLabel}</span>
            <input
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={en.cashflow.descriptionPlaceholder}
            />
          </label>
          {type === "OPENING_BALANCE" ? (
            <p className="dialog-note full-field">{en.cashflow.openingHint}</p>
          ) : null}
          {error ? (
            <div className="form-alert full-field" role="alert">
              {error}
            </div>
          ) : null}
          <footer className="dialog-actions full-field">
            <Button onClick={onClose}>{en.cashflow.close}</Button>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting
                ? en.cashflow.saving
                : existing
                  ? en.cashflow.saveCorrection
                  : en.cashflow.saveOperation}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ManagementView({
  accounts,
  categories,
  includeArchived,
  onIncludeArchived,
  onRefresh,
}: {
  accounts: Account[];
  categories: Category[];
  includeArchived: boolean;
  onIncludeArchived: (value: boolean) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="management-stack">
      <label className="check-field archive-toggle">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(event) => onIncludeArchived(event.target.checked)}
        />
        <span>{en.cashflow.includeArchived}</span>
      </label>
      <div className="management-grid">
        <AccountManager accounts={accounts} onRefresh={onRefresh} />
        <CategoryManager categories={categories} onRefresh={onRefresh} />
      </div>
    </div>
  );
}

function AccountManager({
  accounts,
  onRefresh,
}: {
  accounts: Account[];
  onRefresh: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [subtype, setSubtype] = useState<Account["subtype"]>("bank");
  const [currency, setCurrency] = useState<Account["currency"]>("USD");
  const [opening, setOpening] = useState("");
  const [openingDate, setOpeningDate] = useState(localDate());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createAccount({
        name: name.trim(),
        accountClass: "ASSET",
        subtype,
        currency,
        ...(opening
          ? {
              openingBalance: opening,
              openingBalanceDate: openingDate,
              idempotencyKey: crypto.randomUUID(),
            }
          : {}),
      });
      setName("");
      setOpening("");
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : en.cashflow.managementFailed);
    } finally {
      setSaving(false);
    }
  }

  async function change(account: Account, payload: { name?: string; archived?: boolean }) {
    try {
      await updateAccount(account.id, payload);
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : en.cashflow.managementFailed);
    }
  }

  return (
    <Card title={en.cashflow.accountManagement} subtitle={en.cashflow.accountManagementDescription}>
      <div className="management-list">
        {accounts.map((account) => (
          <div className="management-row" key={account.id}>
            <div>
              <strong>{account.name}</strong>
              <small>
                {account.subtype.replace("_", " ")} · {account.currency} ·{" "}
                {account.hasPostings ? en.cashflow.hasHistory : en.cashflow.noHistory}
              </small>
            </div>
            <div className="row-actions">
              <Button
                onClick={() => {
                  const value = window.prompt(en.cashflow.renamePrompt, account.name);
                  if (value?.trim()) void change(account, { name: value.trim() });
                }}
              >
                {en.cashflow.rename}
              </Button>
              <Button onClick={() => void change(account, { archived: !account.archived })}>
                {account.archived ? en.cashflow.restore : en.cashflow.archive}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <form className="manager-form" onSubmit={(event) => void submit(event)}>
        <h3>{en.cashflow.addAccount}</h3>
        <label className="form-field">
          <span>{en.cashflow.accountName}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="form-field">
          <span>{en.cashflow.accountType}</span>
          <select
            value={subtype}
            onChange={(event) => setSubtype(event.target.value as Account["subtype"])}
          >
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
            <option value="real_estate">Real estate</option>
            <option value="vehicle">Vehicle</option>
            <option value="other">Other asset</option>
          </select>
        </label>
        <label className="form-field">
          <span>{en.cashflow.currency}</span>
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Account["currency"])}
          >
            {supportedCurrencies.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>{en.cashflow.optionalOpeningBalance}</span>
          <input
            inputMode="decimal"
            value={opening}
            onChange={(event) => setOpening(event.target.value)}
          />
        </label>
        {opening ? (
          <label className="form-field">
            <span>{en.cashflow.openingDate}</span>
            <input
              type="date"
              value={openingDate}
              onChange={(event) => setOpeningDate(event.target.value)}
              required
            />
          </label>
        ) : null}
        {error ? (
          <div className="form-alert full-field" role="alert">
            {error}
          </div>
        ) : null}
        <Button variant="primary" type="submit" disabled={saving}>
          {en.cashflow.create}
        </Button>
      </form>
    </Card>
  );
}

function CategoryManager({
  categories,
  onRefresh,
}: {
  categories: Category[];
  onRefresh: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<Category["direction"]>("EXPENSE");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const grouped = useMemo(
    () =>
      ["INCOME", "EXPENSE"].flatMap((item) =>
        categories.filter((category) => category.direction === item),
      ),
    [categories],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createCategory({ name: name.trim(), direction });
      setName("");
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : en.cashflow.managementFailed);
    } finally {
      setSaving(false);
    }
  }

  async function change(category: Category, payload: { name?: string; archived?: boolean }) {
    try {
      await updateCategory(category.id, payload);
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : en.cashflow.managementFailed);
    }
  }

  return (
    <Card
      title={en.cashflow.categoryManagement}
      subtitle={en.cashflow.categoryManagementDescription}
    >
      <div className="management-list">
        {grouped.map((category) => (
          <div className="management-row" key={category.id}>
            <div>
              <strong>{category.name}</strong>
              <small>
                {category.direction === "INCOME"
                  ? en.cashflow.incomeDirection
                  : en.cashflow.expenseDirection}
                {category.archived ? ` · ${en.cashflow.archived}` : ""}
              </small>
            </div>
            <div className="row-actions">
              <Button
                onClick={() => {
                  const value = window.prompt(en.cashflow.renamePrompt, category.name);
                  if (value?.trim()) void change(category, { name: value.trim() });
                }}
              >
                {en.cashflow.rename}
              </Button>
              <Button onClick={() => void change(category, { archived: !category.archived })}>
                {category.archived ? en.cashflow.restore : en.cashflow.archive}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <form className="manager-form" onSubmit={(event) => void submit(event)}>
        <h3>{en.cashflow.addCategory}</h3>
        <label className="form-field">
          <span>{en.cashflow.categoryName}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="form-field">
          <span>{en.cashflow.direction}</span>
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value as Category["direction"])}
          >
            <option value="EXPENSE">{en.cashflow.expenseDirection}</option>
            <option value="INCOME">{en.cashflow.incomeDirection}</option>
          </select>
        </label>
        {error ? (
          <div className="form-alert full-field" role="alert">
            {error}
          </div>
        ) : null}
        <Button variant="primary" type="submit" disabled={saving}>
          {en.cashflow.create}
        </Button>
      </form>
    </Card>
  );
}
