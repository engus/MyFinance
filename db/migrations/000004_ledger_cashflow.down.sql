DROP TRIGGER IF EXISTS users_functional_currency_lock ON users;
ALTER TABLE onboarding_account_setups
    DROP CONSTRAINT IF EXISTS onboarding_account_ledger_account_fk,
    DROP COLUMN IF EXISTS ledger_account_id;
DROP TABLE IF EXISTS ledger_entries;
DROP TABLE IF EXISTS ledger_transactions;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS ledger_accounts;
DROP FUNCTION IF EXISTS prevent_archived_ledger_dependencies();
DROP FUNCTION IF EXISTS enforce_ledger_account_update_rules();
DROP FUNCTION IF EXISTS enforce_functional_currency_lock();
DROP FUNCTION IF EXISTS verify_ledger_transaction_row();
DROP FUNCTION IF EXISTS verify_ledger_transaction_balance();
DROP FUNCTION IF EXISTS enforce_ledger_transaction_immutable();
DROP FUNCTION IF EXISTS allow_entry_only_for_draft_transaction();
DROP FUNCTION IF EXISTS reject_ledger_entry_mutation();
