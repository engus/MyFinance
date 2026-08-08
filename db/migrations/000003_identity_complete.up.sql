ALTER TABLE users
    ADD COLUMN reconciliation_mode text NOT NULL DEFAULT 'CONFIRM',
    ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT now(),
    ADD CONSTRAINT users_reconciliation_mode_valid
        CHECK (reconciliation_mode IN ('AUTO', 'CONFIRM'));

CREATE TABLE totp_credentials (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_ciphertext bytea NOT NULL,
    enabled_at timestamptz,
    last_used_step bigint NOT NULL DEFAULT -1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recovery_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash bytea NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recovery_codes_hash_sha256 CHECK (octet_length(code_hash) = 32),
    UNIQUE (user_id, code_hash)
);

CREATE INDEX recovery_codes_active_user_idx
    ON recovery_codes (user_id)
    WHERE used_at IS NULL;

CREATE TABLE login_challenges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    attempts smallint NOT NULL DEFAULT 0,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT login_challenges_hash_sha256 CHECK (octet_length(token_hash) = 32),
    CONSTRAINT login_challenges_attempts_valid CHECK (attempts BETWEEN 0 AND 10)
);

CREATE INDEX login_challenges_active_expiry_idx
    ON login_challenges (expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE auth_audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    event_type text NOT NULL,
    success boolean NOT NULL,
    request_id text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_audit_events_user_created_idx
    ON auth_audit_events (user_id, created_at DESC);

CREATE TABLE onboarding_account_setups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    account_class text NOT NULL,
    subtype text NOT NULL,
    currency char(3) NOT NULL,
    opening_balance numeric(24, 8) NOT NULL,
    opening_balance_date date NOT NULL,
    ledger_posted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT onboarding_account_name_not_empty CHECK (length(btrim(name)) > 0),
    CONSTRAINT onboarding_account_class_valid
        CHECK (account_class IN ('ASSET', 'LIABILITY')),
    CONSTRAINT onboarding_account_subtype_valid
        CHECK (subtype IN ('bank', 'cash', 'brokerage', 'real_estate', 'vehicle', 'security', 'mortgage', 'loan', 'other'))
);

COMMENT ON TABLE onboarding_account_setups IS
    'First-account setup awaiting immutable opening-balance posting in Milestone 3.';

CREATE TABLE onboarding_recurring_income_setups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    amount numeric(24, 8) NOT NULL,
    currency char(3) NOT NULL,
    day_of_month smallint NOT NULL,
    materialized_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT onboarding_income_name_not_empty CHECK (length(btrim(name)) > 0),
    CONSTRAINT onboarding_income_amount_positive CHECK (amount > 0),
    CONSTRAINT onboarding_income_day_valid CHECK (day_of_month BETWEEN 1 AND 28)
);

COMMENT ON TABLE onboarding_recurring_income_setups IS
    'Optional monthly income setup awaiting recurring-template materialization in Milestone 3.';
