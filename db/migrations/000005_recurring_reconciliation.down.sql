DROP TRIGGER IF EXISTS categories_pause_recurring ON categories;
DROP TRIGGER IF EXISTS ledger_accounts_pause_recurring ON ledger_accounts;
DROP FUNCTION IF EXISTS pause_recurring_for_archived_category();
DROP FUNCTION IF EXISTS pause_recurring_for_archived_account();

DROP TABLE IF EXISTS reconciliation_previews;
DROP TABLE IF EXISTS balance_snapshots;
DROP TABLE IF EXISTS reconciliations;
DROP TABLE IF EXISTS recurring_occurrences;
DROP TABLE IF EXISTS recurring_templates;

ALTER TABLE ledger_transactions
    DROP CONSTRAINT ledger_transactions_type_valid,
    ADD CONSTRAINT ledger_transactions_type_valid CHECK (
        transaction_type IN (
            'OPENING_BALANCE', 'INCOME', 'EXPENSE', 'TRANSFER', 'ASSET_PURCHASE', 'REVERSAL'
        )
    );
