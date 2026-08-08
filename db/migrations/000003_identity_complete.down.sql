DROP TABLE IF EXISTS onboarding_recurring_income_setups;
DROP TABLE IF EXISTS onboarding_account_setups;
DROP TABLE IF EXISTS auth_audit_events;
DROP TABLE IF EXISTS login_challenges;
DROP TABLE IF EXISTS recovery_codes;
DROP TABLE IF EXISTS totp_credentials;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_reconciliation_mode_valid,
    DROP COLUMN IF EXISTS password_changed_at,
    DROP COLUMN IF EXISTS reconciliation_mode;
