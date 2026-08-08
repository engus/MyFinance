CREATE TABLE fx_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL DEFAULT 'YAHOO',
    base_currency char(3) NOT NULL,
    quote_currency char(3) NOT NULL,
    rate numeric(24, 8) NOT NULL,
    rate_date date NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    stale_at timestamptz,
    CONSTRAINT fx_rates_provider_valid CHECK (provider IN ('YAHOO')),
    CONSTRAINT fx_rates_pair_valid CHECK (base_currency <> quote_currency),
    CONSTRAINT fx_rates_positive CHECK (rate > 0),
    UNIQUE (provider, base_currency, quote_currency, rate_date)
);

CREATE INDEX fx_rates_lookup_idx
    ON fx_rates (base_currency, quote_currency, rate_date DESC);

COMMENT ON TABLE fx_rates IS
    'Dated, provider-sourced FX snapshots. A non-null stale_at retains the last usable rate while surfacing freshness to clients.';
