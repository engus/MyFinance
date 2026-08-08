ALTER TABLE ledger_transactions
    DROP CONSTRAINT ledger_transactions_type_valid,
    ADD CONSTRAINT ledger_transactions_type_valid CHECK (
        transaction_type IN (
            'OPENING_BALANCE', 'INCOME', 'EXPENSE', 'TRANSFER',
            'ASSET_PURCHASE', 'RECONCILIATION', 'REVERSAL'
        )
    );

CREATE TABLE recurring_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    operation_type text NOT NULL,
    amount numeric(24, 8) NOT NULL,
    currency char(3) NOT NULL,
    description text,
    account_id uuid,
    category_id uuid,
    source_account_id uuid,
    destination_account_id uuid,
    frequency text NOT NULL,
    interval_unit text NOT NULL,
    interval_count integer NOT NULL DEFAULT 1,
    start_date date NOT NULL,
    next_scheduled_date date NOT NULL,
    end_date date,
    status text NOT NULL DEFAULT 'ACTIVE',
    pause_reason text,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recurring_templates_name_not_empty CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    CONSTRAINT recurring_templates_description_valid CHECK (
        description IS NULL OR length(btrim(description)) BETWEEN 1 AND 500
    ),
    CONSTRAINT recurring_templates_amount_positive CHECK (amount > 0),
    CONSTRAINT recurring_templates_operation_valid CHECK (
        operation_type IN ('INCOME', 'EXPENSE', 'TRANSFER', 'ASSET_PURCHASE')
    ),
    CONSTRAINT recurring_templates_frequency_valid CHECK (
        frequency IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM')
    ),
    CONSTRAINT recurring_templates_interval_unit_valid CHECK (
        interval_unit IN ('DAYS', 'WEEKS', 'MONTHS', 'YEARS')
    ),
    CONSTRAINT recurring_templates_interval_positive CHECK (interval_count BETWEEN 1 AND 365),
    CONSTRAINT recurring_templates_status_valid CHECK (status IN ('ACTIVE', 'PAUSED')),
    CONSTRAINT recurring_templates_dates_valid CHECK (
        next_scheduled_date >= start_date AND (end_date IS NULL OR end_date >= start_date)
    ),
    CONSTRAINT recurring_templates_standard_schedule_valid CHECK (
        frequency = 'CUSTOM'
        OR (frequency = 'WEEKLY' AND interval_unit = 'WEEKS' AND interval_count = 1)
        OR (frequency = 'MONTHLY' AND interval_unit = 'MONTHS' AND interval_count = 1)
        OR (frequency = 'QUARTERLY' AND interval_unit = 'MONTHS' AND interval_count = 3)
        OR (frequency = 'YEARLY' AND interval_unit = 'YEARS' AND interval_count = 1)
    ),
    CONSTRAINT recurring_templates_operation_shape CHECK (
        (
            operation_type IN ('INCOME', 'EXPENSE')
            AND account_id IS NOT NULL
            AND category_id IS NOT NULL
            AND source_account_id IS NULL
            AND destination_account_id IS NULL
        )
        OR (
            operation_type IN ('TRANSFER', 'ASSET_PURCHASE')
            AND account_id IS NULL
            AND category_id IS NULL
            AND source_account_id IS NOT NULL
            AND destination_account_id IS NOT NULL
            AND source_account_id <> destination_account_id
        )
    ),
    UNIQUE (id, user_id),
    FOREIGN KEY (account_id, user_id) REFERENCES ledger_accounts(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (category_id, user_id) REFERENCES categories(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_account_id, user_id) REFERENCES ledger_accounts(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (destination_account_id, user_id) REFERENCES ledger_accounts(id, user_id) ON DELETE RESTRICT
);

CREATE INDEX recurring_templates_due_idx
    ON recurring_templates (next_scheduled_date, id)
    WHERE status = 'ACTIVE' AND archived_at IS NULL;

CREATE TABLE recurring_occurrences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id uuid NOT NULL,
    scheduled_date date NOT NULL,
    transaction_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (template_id, scheduled_date),
    UNIQUE (transaction_id),
    FOREIGN KEY (template_id, user_id)
        REFERENCES recurring_templates(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (transaction_id, user_id)
        REFERENCES ledger_transactions(id, user_id) ON DELETE RESTRICT
);

CREATE INDEX recurring_occurrences_user_date_idx
    ON recurring_occurrences (user_id, scheduled_date DESC, id DESC);

CREATE TABLE reconciliations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    period_end date NOT NULL,
    reported_balance numeric(24, 8) NOT NULL,
    ledger_balance_before numeric(24, 8) NOT NULL,
    net_difference numeric(24, 8) NOT NULL,
    adjustment_amount numeric(24, 8) NOT NULL,
    adjustment_transaction_id uuid,
    reversal_transaction_id uuid,
    supersedes_reconciliation_id uuid,
    gap_start_period_end date,
    gap_months integer NOT NULL DEFAULT 1,
    idempotency_key uuid NOT NULL,
    superseded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT reconciliations_period_is_month_end CHECK (
        period_end = (date_trunc('month', period_end) + interval '1 month - 1 day')::date
    ),
    CONSTRAINT reconciliations_gap_valid CHECK (
        gap_months >= 1
        AND (
            (gap_months = 1 AND gap_start_period_end IS NULL)
            OR (gap_months > 1 AND gap_start_period_end IS NOT NULL)
        )
    ),
    UNIQUE (id, user_id),
    UNIQUE (user_id, idempotency_key),
    FOREIGN KEY (account_id, user_id)
        REFERENCES ledger_accounts(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (adjustment_transaction_id, user_id)
        REFERENCES ledger_transactions(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (reversal_transaction_id, user_id)
        REFERENCES ledger_transactions(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_reconciliation_id, user_id)
        REFERENCES reconciliations(id, user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX reconciliations_active_period_idx
    ON reconciliations (user_id, account_id, period_end)
    WHERE superseded_at IS NULL;

CREATE INDEX reconciliations_account_history_idx
    ON reconciliations (user_id, account_id, period_end DESC, created_at DESC);

CREATE TABLE balance_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    reconciliation_id uuid NOT NULL,
    period_end date NOT NULL,
    reported_balance numeric(24, 8) NOT NULL,
    currency char(3) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (reconciliation_id),
    FOREIGN KEY (account_id, user_id, currency)
        REFERENCES ledger_accounts(id, user_id, currency) ON DELETE RESTRICT,
    FOREIGN KEY (reconciliation_id, user_id)
        REFERENCES reconciliations(id, user_id) ON DELETE RESTRICT
);

CREATE INDEX balance_snapshots_user_period_idx
    ON balance_snapshots (user_id, period_end DESC, account_id);

CREATE TABLE reconciliation_previews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    period_end date NOT NULL,
    reported_balance numeric(24, 8) NOT NULL,
    ledger_balance numeric(24, 8) NOT NULL,
    net_difference numeric(24, 8) NOT NULL,
    idempotency_key uuid NOT NULL,
    current_reconciliation_id uuid,
    confirmed_reconciliation_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    confirmed_at timestamptz,
    UNIQUE (id, user_id),
    UNIQUE (user_id, idempotency_key),
    FOREIGN KEY (account_id, user_id)
        REFERENCES ledger_accounts(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (current_reconciliation_id, user_id)
        REFERENCES reconciliations(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (confirmed_reconciliation_id, user_id)
        REFERENCES reconciliations(id, user_id) ON DELETE RESTRICT
);

CREATE INDEX reconciliation_previews_expiry_idx
    ON reconciliation_previews (expires_at) WHERE confirmed_at IS NULL;

CREATE OR REPLACE FUNCTION pause_recurring_for_archived_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
        UPDATE recurring_templates
           SET status = 'PAUSED',
               pause_reason = 'DEPENDENCY_ARCHIVED',
               updated_at = now()
         WHERE user_id = NEW.user_id
           AND archived_at IS NULL
           AND status = 'ACTIVE'
           AND NEW.id IN (account_id, source_account_id, destination_account_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION pause_recurring_for_archived_category()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
        UPDATE recurring_templates
           SET status = 'PAUSED',
               pause_reason = 'DEPENDENCY_ARCHIVED',
               updated_at = now()
         WHERE user_id = NEW.user_id
           AND archived_at IS NULL
           AND status = 'ACTIVE'
           AND category_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_accounts_pause_recurring
AFTER UPDATE OF archived_at ON ledger_accounts
FOR EACH ROW EXECUTE FUNCTION pause_recurring_for_archived_account();

CREATE TRIGGER categories_pause_recurring
AFTER UPDATE OF archived_at ON categories
FOR EACH ROW EXECUTE FUNCTION pause_recurring_for_archived_category();

COMMENT ON TABLE recurring_occurrences IS
    'One immutable generation claim per template and scheduled financial date.';
COMMENT ON TABLE reconciliation_previews IS
    'Short-lived optimistic previews revalidated under an account lock before confirmation.';
COMMENT ON TABLE balance_snapshots IS
    'Reported account balances captured by completed reconciliation.';
