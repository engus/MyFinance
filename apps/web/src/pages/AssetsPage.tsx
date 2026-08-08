import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";

import {
  ApiError,
  createAsset,
  createAssetValuation,
  listAccounts,
  listAssetValuations,
  listAssets,
  updateAsset,
  type Asset,
  type CreateAssetRequest,
} from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncState";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { supportedCurrencies } from "../financial-options";
import { en } from "../i18n/en";

type AssetType = CreateAssetRequest["type"];

const assetTypes: AssetType[] = [
  "REAL_ESTATE",
  "SECURITIES",
  "BUSINESS",
  "VEHICLE",
  "COLLECTIBLES",
  "OTHER",
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

function assetTypeLabel(type: AssetType) {
  return en.assets.typeLabels[type];
}

export function AssetsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [valuationOpen, setValuationOpen] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const assetsQuery = useQuery({
    queryKey: ["assets", includeArchived],
    queryFn: () => listAssets(includeArchived),
  });
  const accountsQuery = useQuery({
    queryKey: ["ledger-accounts", "assets"],
    queryFn: () => listAccounts(),
  });
  const selectedAsset =
    assetsQuery.data?.assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const valuationsQuery = useQuery({
    queryKey: ["asset-valuations", selectedAssetId],
    queryFn: () => listAssetValuations(selectedAssetId!),
    enabled: selectedAssetId !== null,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["assets"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger-accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["ledger-transactions"] }),
    ]);
  };
  const archiveMutation = useMutation({
    mutationFn: (asset: Asset) => updateAsset(asset.id, { archived: !asset.archived }),
    onSuccess: refresh,
  });
  const activeAccounts = useMemo(
    () =>
      (accountsQuery.data ?? []).filter(
        (account) => !account.archived && account.accountClass === "ASSET",
      ),
    [accountsQuery.data],
  );

  return (
    <section className="page-stack assets-page">
      <header className="cashflow-hero">
        <div>
          <span className="eyebrow">{en.assets.eyebrow}</span>
          <h2>{en.assets.title}</h2>
          <p>{en.assets.description}</p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <span aria-hidden="true">＋</span> {en.assets.add}
        </Button>
      </header>

      {assetsQuery.isLoading ? (
        <Card>
          <LoadingState label={en.assets.loading} />
        </Card>
      ) : null}
      {assetsQuery.isError ? (
        <Card>
          <ErrorState label={en.assets.loadError} onRetry={() => void assetsQuery.refetch()} />
        </Card>
      ) : null}

      {assetsQuery.data ? (
        <>
          <div className="asset-summary-grid">
            <Card className="asset-total-card">
              <span>{en.assets.total}</span>
              <strong>
                {exactDisplay(
                  assetsQuery.data.totalCurrentOwnedValue,
                  assetsQuery.data.assets[0]?.currency ?? "USD",
                )}
              </strong>
              <small>{en.assets.totalHint}</small>
            </Card>
            <Card className="allocation-card">
              <span>{en.assets.allocation}</span>
              {assetsQuery.data.allocations.length ? (
                <div className="allocation-list">
                  {assetsQuery.data.allocations.map((allocation) => (
                    <div key={allocation.type}>
                      <span>{assetTypeLabel(allocation.type)}</span>
                      <strong>
                        {exactDisplay(
                          allocation.currentOwnedValue,
                          assetsQuery.data.assets[0]?.currency ?? "USD",
                        )}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <small>{en.assets.noAllocation}</small>
              )}
            </Card>
          </div>

          <label className="compact-check archive-toggle">
            <input
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
              type="checkbox"
            />
            {en.assets.showArchived}
          </label>

          {assetsQuery.data.assets.length === 0 ? (
            <EmptyState description={en.assets.empty} title={en.states.emptyTitle} />
          ) : (
            <div className="asset-grid">
              {assetsQuery.data.assets.map((asset) => (
                <article
                  className={`asset-card${selectedAssetId === asset.id ? " selected" : ""}`}
                  key={asset.id}
                >
                  <button
                    className="asset-card-main"
                    onClick={() => setSelectedAssetId(asset.id)}
                    type="button"
                  >
                    <span className="asset-type-pill">{assetTypeLabel(asset.type)}</span>
                    <strong>{asset.name}</strong>
                    <small>
                      {asset.ownershipShare}% {en.assets.ownership}
                    </small>
                    <b>{exactDisplay(asset.currentOwnedValue, asset.currency)}</b>
                    <em>
                      {asset.latestValuationDate
                        ? `${en.assets.updated} ${asset.latestValuationDate}`
                        : en.assets.costBasis}
                    </em>
                  </button>
                  <div className="asset-card-actions">
                    <Button
                      disabled={asset.archived}
                      onClick={() => {
                        setSelectedAssetId(asset.id);
                        setValuationOpen(true);
                      }}
                      variant="secondary"
                    >
                      {en.assets.updateValue}
                    </Button>
                    <Button
                      disabled={archiveMutation.isPending}
                      onClick={() => archiveMutation.mutate(asset)}
                      variant="secondary"
                    >
                      {asset.archived ? en.assets.restore : en.assets.archive}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

      {selectedAsset ? (
        <Card className="valuation-history">
          <div className="feature-heading">
            <div>
              <h3>{en.assets.historyTitle}</h3>
              <p>
                {selectedAsset.name} · {selectedAsset.ledgerAccountName}
              </p>
            </div>
            <Button
              disabled={selectedAsset.archived}
              onClick={() => setValuationOpen(true)}
              variant="secondary"
            >
              {en.assets.updateValue}
            </Button>
          </div>
          {valuationsQuery.isLoading ? <LoadingState label={en.assets.historyLoading} /> : null}
          {valuationsQuery.isError ? (
            <ErrorState
              label={en.assets.historyError}
              onRetry={() => void valuationsQuery.refetch()}
            />
          ) : null}
          {valuationsQuery.data && valuationsQuery.data.length === 0 ? (
            <p className="dialog-note">{en.assets.historyEmpty}</p>
          ) : null}
          {valuationsQuery.data?.length ? (
            <div className="valuation-table">
              {valuationsQuery.data.map((valuation) => (
                <div key={valuation.id}>
                  <time>{valuation.valuationDate}</time>
                  <span>{exactDisplay(valuation.marketValue, selectedAsset.currency)}</span>
                  <strong>{exactDisplay(valuation.ownedValue, selectedAsset.currency)}</strong>
                  <em
                    className={
                      valuation.adjustmentAmount.startsWith("-")
                        ? "amount-negative"
                        : "amount-positive"
                    }
                  >
                    {valuation.adjustmentAmount.startsWith("-") ? "" : "+"}
                    {exactDisplay(valuation.adjustmentAmount, selectedAsset.currency)}
                  </em>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {createOpen ? (
        <AssetDialog
          accounts={activeAccounts}
          onClose={() => setCreateOpen(false)}
          onSaved={async (asset) => {
            setCreateOpen(false);
            setSelectedAssetId(asset.id);
            await refresh();
          }}
        />
      ) : null}
      {valuationOpen && selectedAsset ? (
        <ValuationDialog
          asset={selectedAsset}
          onClose={() => setValuationOpen(false)}
          onSaved={async () => {
            setValuationOpen(false);
            await Promise.all([
              refresh(),
              queryClient.invalidateQueries({ queryKey: ["asset-valuations", selectedAsset.id] }),
            ]);
          }}
        />
      ) : null}
    </section>
  );
}

function AssetDialog({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: Awaited<ReturnType<typeof listAccounts>>;
  onClose: () => void;
  onSaved: (asset: Asset) => Promise<void>;
}) {
  const [type, setType] = useState<AssetType>("REAL_ESTATE");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [ownershipShare, setOwnershipShare] = useState("100");
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [institution, setInstitution] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(localDate());
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: createAsset,
    onSuccess: (asset) => void onSaved(asset),
    onError: (reason) =>
      setError(reason instanceof ApiError ? reason.message : en.assets.saveError),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if ((sourceAccountId && !purchaseAmount) || (!sourceAccountId && purchaseAmount)) {
      setError(en.assets.purchaseIncomplete);
      return;
    }
    mutation.mutate({
      type,
      name,
      currency: currency as CreateAssetRequest["currency"],
      ownershipShare,
      idempotencyKey: crypto.randomUUID(),
      ...(country ? { country } : {}),
      ...(region ? { region } : {}),
      ...(institution ? { institution } : {}),
      ...(notes ? { notes } : {}),
      ...(sourceAccountId
        ? { purchase: { sourceAccountId, amount: purchaseAmount, eventDate: purchaseDate } }
        : {}),
    });
  };
  return (
    <Dialog title={en.assets.createTitle} onClose={onClose}>
      <form className="ledger-form" onSubmit={submit}>
        <Field label={en.assets.type}>
          <select value={type} onChange={(event) => setType(event.target.value as AssetType)}>
            {assetTypes.map((value) => (
              <option key={value} value={value}>
                {assetTypeLabel(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={en.assets.name}>
          <input
            autoFocus
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </Field>
        <Field label={en.assets.currency}>
          <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
            {supportedCurrencies.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label={en.assets.ownershipShare}>
          <input
            inputMode="decimal"
            max="100"
            min="0.01"
            onChange={(event) => setOwnershipShare(event.target.value)}
            required
            step="0.01"
            value={ownershipShare}
          />
        </Field>
        <Field label={en.assets.country}>
          <input onChange={(event) => setCountry(event.target.value)} value={country} />
        </Field>
        <Field label={en.assets.region}>
          <input onChange={(event) => setRegion(event.target.value)} value={region} />
        </Field>
        <Field label={en.assets.institution}>
          <input onChange={(event) => setInstitution(event.target.value)} value={institution} />
        </Field>
        <Field label={en.assets.notes}>
          <input onChange={(event) => setNotes(event.target.value)} value={notes} />
        </Field>
        <p className="dialog-note full-field">{en.assets.purchaseHint}</p>
        <Field label={en.assets.purchaseAccount}>
          <select
            onChange={(event) => setSourceAccountId(event.target.value)}
            value={sourceAccountId}
          >
            <option value="">{en.assets.noPurchase}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.currency}
              </option>
            ))}
          </select>
        </Field>
        <Field label={en.assets.purchaseAmount}>
          <input
            inputMode="decimal"
            onChange={(event) => setPurchaseAmount(event.target.value)}
            placeholder="0.00"
            value={purchaseAmount}
          />
        </Field>
        <Field label={en.assets.purchaseDate}>
          <input
            onChange={(event) => setPurchaseDate(event.target.value)}
            type="date"
            value={purchaseDate}
          />
        </Field>
        {error ? <p className="form-error full-field">{error}</p> : null}
        <div className="dialog-actions full-field">
          <Button onClick={onClose} type="button" variant="secondary">
            {en.cashflow.close}
          </Button>
          <Button disabled={mutation.isPending} type="submit" variant="primary">
            {mutation.isPending ? en.assets.saving : en.assets.create}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ValuationDialog({
  asset,
  onClose,
  onSaved,
}: {
  asset: Asset;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [marketValue, setMarketValue] = useState(
    asset.latestMarketValue ?? asset.currentOwnedValue,
  );
  const [valuationDate, setValuationDate] = useState(localDate());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      createAssetValuation(asset.id, {
        marketValue,
        valuationDate,
        idempotencyKey: crypto.randomUUID(),
        ...(notes ? { notes } : {}),
      }),
    onSuccess: () => void onSaved(),
    onError: (reason) =>
      setError(reason instanceof ApiError ? reason.message : en.assets.valuationError),
  });
  return (
    <Dialog title={en.assets.valuationTitle} onClose={onClose}>
      <form
        className="ledger-form"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          mutation.mutate();
        }}
      >
        <p className="dialog-note full-field">
          {en.assets.valuationHint(asset.name, asset.ownershipShare)}
        </p>
        <Field label={en.assets.marketValue}>
          <input
            autoFocus
            inputMode="decimal"
            onChange={(event) => setMarketValue(event.target.value)}
            required
            value={marketValue}
          />
        </Field>
        <Field label={en.assets.valuationDate}>
          <input
            onChange={(event) => setValuationDate(event.target.value)}
            required
            type="date"
            value={valuationDate}
          />
        </Field>
        <Field label={en.assets.notes}>
          <input onChange={(event) => setNotes(event.target.value)} value={notes} />
        </Field>
        {error ? <p className="form-error full-field">{error}</p> : null}
        <div className="dialog-actions full-field">
          <Button onClick={onClose} type="button" variant="secondary">
            {en.cashflow.close}
          </Button>
          <Button disabled={mutation.isPending} type="submit" variant="primary">
            {mutation.isPending ? en.assets.saving : en.assets.saveValue}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Dialog({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className="ledger-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <span className="eyebrow">{en.assets.eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <button
            aria-label={en.cashflow.close}
            className="dialog-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
