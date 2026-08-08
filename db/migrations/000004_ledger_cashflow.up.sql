CREATE TABLE ledger_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    account_class text NOT NULL,
    subtype text NOT NULL,
    role text NOT NULL DEFAULT 'USER',
    currency char(3) NOT NULL,
    system_code text,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ledger_accounts_name_not_empty CHECK (length(btrim(name)) > 0),
    CONSTRAINT ledger_accounts_class_valid
        CHECK (account_class IN ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')),
    CONSTRAINT ledger_accounts_subtype_valid
        CHECK (subtype IN ('bank', 'cash', 'brokerage', 'real_estate', 'vehicle', 'security', 'mortgage', 'loan', 'other', 'equity', 'category')),
    CONSTRAINT ledger_accounts_role_valid CHECK (role IN ('USER', 'SYSTEM', 'CATEGORY')),
    CONSTRAINT ledger_accounts_role_class_valid CHECK (
        (role = 'USER' AND account_class IN ('ASSET', 'LIABILITY'))
        OR (role = 'SYSTEM' AND account_class IN ('EQUITY', 'INCOME', 'EXPENSE'))
        OR (role = 'CATEGORY' AND account_class IN ('INCOME', 'EXPENSE'))
    ),
    CONSTRAINT ledger_accounts_system_code_valid CHECK (
        (role = 'SYSTEM' AND system_code IS NOT NULL)
        OR (role <> 'SYSTEM' AND system_code IS NULL)
    ),
    UNIQUE (id, user_id),
    UNIQUE (id, user_id, currency)
);

CREATE INDEX ledger_accounts_user_active_idx
    ON ledger_accounts (user_id, role, account_class, created_at)
    WHERE archived_at IS NULL;

CREATE UNIQUE INDEX ledger_accounts_user_system_code_idx
    ON ledger_accounts (user_id, system_code)
    WHERE system_code IS NOT NULL;

ALTER TABLE onboarding_account_setups
    ADD COLUMN ledger_account_id uuid,
    ADD CONSTRAINT onboarding_account_ledger_account_fk
        FOREIGN KEY (ledger_account_id, user_id)
        REFERENCES ledger_accounts(id, user_id) ON DELETE RESTRICT;

CREATE TABLE categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    direction text NOT NULL,
    ledger_account_id uuid NOT NULL,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT categories_name_not_empty CHECK (length(btrim(name)) > 0),
    CONSTRAINT categories_direction_valid CHECK (direction IN ('INCOME', 'EXPENSE')),
    UNIQUE (id, user_id),
    UNIQUE (id, user_id, ledger_account_id),
    UNIQUE (ledger_account_id),
    FOREIGN KEY (ledger_account_id, user_id)
        REFERENCES ledger_accounts(id, user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX categories_user_active_name_idx
    ON categories (user_id, direction, lower(name))
    WHERE archived_at IS NULL;

CREATE TABLE ledger_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_type text NOT NULL,
    event_date date NOT NULL,
    description text,
    idempotency_key uuid NOT NULL,
    reverses_transaction_id uuid,
    replaces_transaction_id uuid,
    posted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ledger_transactions_type_valid CHECK (
        transaction_type IN ('OPENING_BALANCE', 'INCOME', 'EXPENSE', 'TRANSFER', 'ASSET_PURCHASE', 'REVERSAL')
    ),
    CONSTRAINT ledger_transactions_description_valid CHECK (
        description IS NULL OR length(btrim(description)) BETWEEN 1 AND 500
    ),
    CONSTRAINT ledger_transactions_reversal_shape CHECK (
        (transaction_type = 'REVERSAL' AND reverses_transaction_id IS NOT NULL)
        OR (transaction_type <> 'REVERSAL' AND reverses_transaction_id IS NULL)
    ),
    CONSTRAINT ledger_transactions_not_self_referencing CHECK (
        reverses_transaction_id IS DISTINCT FROM id
        AND replaces_transaction_id IS DISTINCT FROM id
    ),
    UNIQUE (id, user_id),
    UNIQUE (user_id, idempotency_key),
    UNIQUE (user_id, reverses_transaction_id),
    UNIQUE (user_id, replaces_transaction_id),
    FOREIGN KEY (reverses_transaction_id, user_id)
        REFERENCES ledger_transactions(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (replaces_transaction_id, user_id)
        REFERENCES ledger_transactions(id, user_id) ON DELETE RESTRICT
);

CREATE INDEX ledger_transactions_user_event_cursor_idx
    ON ledger_transactions (user_id, event_date DESC, id DESC)
    WHERE posted_at IS NOT NULL;

CREATE TABLE ledger_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id uuid NOT NULL,
    category_id uuid,
    original_amount numeric(24, 8) NOT NULL,
    currency char(3) NOT NULL,
    functional_amount numeric(24, 8) NOT NULL,
    fx_rate numeric(24, 8) NOT NULL,
    fx_source text NOT NULL,
    fx_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ledger_entries_non_zero CHECK (original_amount <> 0 AND functional_amount <> 0),
    CONSTRAINT ledger_entries_fx_positive CHECK (fx_rate > 0),
    CONSTRAINT ledger_entries_signs_match CHECK (
        sign(original_amount) = sign(functional_amount)
    ),
    CONSTRAINT ledger_entries_fx_source_valid CHECK (fx_source IN ('IDENTITY', 'YAHOO', 'MANUAL')),
    UNIQUE (id, user_id),
    FOREIGN KEY (transaction_id, user_id)
        REFERENCES ledger_transactions(id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (account_id, user_id, currency)
        REFERENCES ledger_accounts(id, user_id, currency) ON DELETE RESTRICT,
    FOREIGN KEY (category_id, user_id, account_id)
        REFERENCES categories(id, user_id, ledger_account_id) ON DELETE RESTRICT
);

CREATE INDEX ledger_entries_user_account_idx ON ledger_entries (user_id, account_id);
CREATE INDEX ledger_entries_user_category_idx
    ON ledger_entries (user_id, category_id)
    WHERE category_id IS NOT NULL;

CREATE OR REPLACE FUNCTION reject_ledger_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'posted ledger entries are immutable'
        USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION allow_entry_only_for_draft_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM ledger_transactions
        WHERE id = NEW.transaction_id
          AND user_id = NEW.user_id
          AND posted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'entries can only be appended to an unposted transaction'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_ledger_transaction_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'posted ledger transactions are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.posted_at IS NULL
       AND NEW.posted_at IS NOT NULL
       AND NEW.id = OLD.id
       AND NEW.user_id = OLD.user_id
       AND NEW.transaction_type = OLD.transaction_type
       AND NEW.event_date = OLD.event_date
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.idempotency_key = OLD.idempotency_key
       AND NEW.reverses_transaction_id IS NOT DISTINCT FROM OLD.reverses_transaction_id
       AND NEW.replaces_transaction_id IS NOT DISTINCT FROM OLD.replaces_transaction_id
       AND NEW.created_at = OLD.created_at THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'ledger transactions can only transition from draft to posted'
        USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION verify_ledger_transaction_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    transaction_posted_at timestamptz;
    entry_count integer;
    functional_total numeric(24, 8);
BEGIN
    SELECT posted_at
      INTO transaction_posted_at
      FROM ledger_transactions
     WHERE id = NEW.transaction_id
       AND user_id = NEW.user_id;

    IF transaction_posted_at IS NULL THEN
        RAISE EXCEPTION 'ledger transaction must be posted before commit'
            USING ERRCODE = '23514';
    END IF;

    SELECT count(*), COALESCE(sum(functional_amount), 0)
      INTO entry_count, functional_total
      FROM ledger_entries
     WHERE transaction_id = NEW.transaction_id
       AND user_id = NEW.user_id;

    IF entry_count < 2 THEN
        RAISE EXCEPTION 'ledger transaction requires at least two entries'
            USING ERRCODE = '23514';
    END IF;
    IF functional_total <> 0 THEN
        RAISE EXCEPTION 'ledger transaction is not balanced in functional currency'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION verify_ledger_transaction_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    current_row ledger_transactions%ROWTYPE;
    entry_count integer;
    functional_total numeric(24, 8);
BEGIN
    SELECT * INTO current_row
      FROM ledger_transactions
     WHERE id = NEW.id
       AND user_id = NEW.user_id;

    IF current_row.posted_at IS NULL THEN
        RAISE EXCEPTION 'ledger transaction must be posted before commit'
            USING ERRCODE = '23514';
    END IF;

    SELECT count(*), COALESCE(sum(functional_amount), 0)
      INTO entry_count, functional_total
      FROM ledger_entries
     WHERE transaction_id = NEW.id
       AND user_id = NEW.user_id;

    IF entry_count < 2 OR functional_total <> 0 THEN
        RAISE EXCEPTION 'posted ledger transaction must have two or more balanced entries'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER ledger_entries_draft_insert
BEFORE INSERT ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION allow_entry_only_for_draft_transaction();

CREATE TRIGGER ledger_entries_immutable
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_ledger_entry_mutation();

CREATE TRIGGER ledger_transactions_immutable
BEFORE UPDATE OR DELETE ON ledger_transactions
FOR EACH ROW EXECUTE FUNCTION enforce_ledger_transaction_immutable();

CREATE CONSTRAINT TRIGGER ledger_entries_balanced_at_commit
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verify_ledger_transaction_balance();

CREATE CONSTRAINT TRIGGER ledger_transactions_balanced_at_commit
AFTER INSERT OR UPDATE OF posted_at ON ledger_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verify_ledger_transaction_row();

CREATE OR REPLACE FUNCTION prevent_archived_ledger_dependencies()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM ledger_transactions
        WHERE id = NEW.transaction_id
          AND user_id = NEW.user_id
          AND transaction_type = 'REVERSAL'
    ) THEN
        RETURN NEW;
    END IF;
    IF EXISTS (
        SELECT 1 FROM ledger_accounts
        WHERE id = NEW.account_id
          AND user_id = NEW.user_id
          AND archived_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'archived accounts cannot receive new entries'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.category_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM categories
        WHERE id = NEW.category_id
          AND user_id = NEW.user_id
          AND archived_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'archived categories cannot receive new entries'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_ledger_account_update_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.user_id <> OLD.user_id
       OR NEW.account_class <> OLD.account_class
       OR NEW.subtype <> OLD.subtype
       OR NEW.role <> OLD.role
       OR NEW.system_code IS DISTINCT FROM OLD.system_code
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'ledger account identity fields are immutable'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.currency <> OLD.currency AND EXISTS (
        SELECT 1 FROM ledger_entries
        WHERE account_id = OLD.id AND user_id = OLD.user_id
    ) THEN
        RAISE EXCEPTION 'account currency is locked after its first posting'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_functional_currency_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.functional_currency <> OLD.functional_currency AND EXISTS (
        SELECT 1 FROM ledger_transactions
        WHERE user_id = OLD.id AND posted_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'functional currency is locked after the first posting'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entries_active_dependencies
BEFORE INSERT ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_archived_ledger_dependencies();

CREATE TRIGGER ledger_accounts_update_rules
BEFORE UPDATE ON ledger_accounts
FOR EACH ROW EXECUTE FUNCTION enforce_ledger_account_update_rules();

CREATE TRIGGER users_functional_currency_lock
BEFORE UPDATE OF functional_currency ON users
FOR EACH ROW EXECUTE FUNCTION enforce_functional_currency_lock();

COMMENT ON TABLE ledger_transactions IS
    'Immutable posted journal. Corrections are represented by reversal and replacement transactions.';
COMMENT ON TABLE ledger_entries IS
    'Signed exact-decimal entries carrying original and functional amounts plus the immutable FX snapshot.';
