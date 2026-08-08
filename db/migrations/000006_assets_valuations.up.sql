ALTER TABLE ledger_transactions
    DROP CONSTRAINT ledger_transactions_type_valid,
    ADD CONSTRAINT ledger_transactions_type_valid CHECK (
        transaction_type IN (
            'OPENING_BALANCE', 'INCOME', 'EXPENSE', 'TRANSFER',
            'ASSET_PURCHASE', 'RECONCILIATION', 'REVALUATION', 'REVERSAL'
        )
    );

CREATE TABLE assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ledger_account_id uuid NOT NULL,
    name text NOT NULL,
    asset_type text NOT NULL,
    currency char(3) NOT NULL,
    ownership_share numeric(5, 2) NOT NULL DEFAULT 100,
    country text,
    region text,
    institution text,
    notes text,
    creation_idempotency_key uuid NOT NULL,
    purchase_transaction_id uuid,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT assets_name_valid CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    CONSTRAINT assets_type_valid CHECK (
        asset_type IN ('REAL_ESTATE', 'VEHICLE', 'BUSINESS', 'SECURITIES', 'COLLECTIBLES', 'OTHER')
    ),
    CONSTRAINT assets_ownership_share_valid CHECK (ownership_share > 0 AND ownership_share <= 100),
    CONSTRAINT assets_country_valid CHECK (country IS NULL OR length(btrim(country)) BETWEEN 1 AND 100),
    CONSTRAINT assets_region_valid CHECK (region IS NULL OR length(btrim(region)) BETWEEN 1 AND 100),
    CONSTRAINT assets_institution_valid CHECK (institution IS NULL OR length(btrim(institution)) BETWEEN 1 AND 150),
    CONSTRAINT assets_notes_valid CHECK (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 2000),
    UNIQUE (id, user_id),
    UNIQUE (user_id, creation_idempotency_key),
    UNIQUE (ledger_account_id),
    FOREIGN KEY (ledger_account_id, user_id)
        REFERENCES ledger_accounts(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (purchase_transaction_id, user_id)
        REFERENCES ledger_transactions(id, user_id) ON DELETE RESTRICT
);

CREATE INDEX assets_user_active_idx
    ON assets (user_id, asset_type, created_at)
    WHERE archived_at IS NULL;

CREATE TABLE asset_valuations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id uuid NOT NULL,
    valuation_date date NOT NULL,
    market_value numeric(24, 8) NOT NULL,
    owned_value numeric(24, 8) NOT NULL,
    ledger_balance_before numeric(24, 8) NOT NULL,
    adjustment_amount numeric(24, 8) NOT NULL,
    notes text,
    idempotency_key uuid NOT NULL,
    revaluation_transaction_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT asset_valuations_market_value_non_negative CHECK (market_value >= 0),
    CONSTRAINT asset_valuations_owned_value_non_negative CHECK (owned_value >= 0),
    CONSTRAINT asset_valuations_notes_valid CHECK (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 1000),
    UNIQUE (id, user_id),
    UNIQUE (user_id, idempotency_key),
    FOREIGN KEY (asset_id, user_id) REFERENCES assets(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (revaluation_transaction_id, user_id)
        REFERENCES ledger_transactions(id, user_id) ON DELETE RESTRICT
);

CREATE INDEX asset_valuations_history_idx
    ON asset_valuations (asset_id, valuation_date DESC, created_at DESC);

COMMENT ON TABLE assets IS
    'Manual asset profiles linked one-to-one with private asset ledger accounts.';
COMMENT ON TABLE asset_valuations IS
    'Immutable manual market-value snapshots; each value posts only its delta through REVALUATION.';
