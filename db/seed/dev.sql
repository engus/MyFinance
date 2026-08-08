-- The development-only demo password is documented in README.md. Only its Argon2id hash is stored.
INSERT INTO users (
    id,
    email,
    display_name,
    password_hash,
    timezone,
    functional_currency,
    display_currency,
    reconciliation_mode,
    onboarding_completed
)
VALUES (
    '00000000-0000-4000-8000-000000000001',
    'demo@myfinance.local',
    'Demo User',
    '$argon2id$v=19$m=65536,t=3,p=2$umHlv8Zv975/UtZqGMayLQ$MYzWQ3SwvrJ2dd1i4zWW3A2Wzggb3BZ36Yh0mXoFOqU',
    'Asia/Almaty',
    'USD',
    'USD',
    'CONFIRM',
    true
)
ON CONFLICT (email) DO UPDATE
SET display_name = EXCLUDED.display_name,
    password_hash = EXCLUDED.password_hash,
    timezone = EXCLUDED.timezone,
    functional_currency = EXCLUDED.functional_currency,
    display_currency = EXCLUDED.display_currency,
    reconciliation_mode = EXCLUDED.reconciliation_mode,
    onboarding_completed = EXCLUDED.onboarding_completed,
    updated_at = now();

INSERT INTO onboarding_account_setups (
    id,
    user_id,
    name,
    account_class,
    subtype,
    currency,
    opening_balance,
    opening_balance_date
)
VALUES (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'Primary checking',
    'ASSET',
    'bank',
    'USD',
    12450.75,
    DATE '2026-08-01'
)
ON CONFLICT (user_id) DO UPDATE
SET name = EXCLUDED.name,
    account_class = EXCLUDED.account_class,
    subtype = EXCLUDED.subtype,
    currency = EXCLUDED.currency,
    opening_balance = EXCLUDED.opening_balance,
    opening_balance_date = EXCLUDED.opening_balance_date,
    updated_at = now();

INSERT INTO onboarding_recurring_income_setups (
    id,
    user_id,
    name,
    amount,
    currency,
    day_of_month
)
VALUES (
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000001',
    'Monthly salary',
    4800.00,
    'USD',
    25
)
ON CONFLICT (user_id) DO UPDATE
SET name = EXCLUDED.name,
    amount = EXCLUDED.amount,
    currency = EXCLUDED.currency,
    day_of_month = EXCLUDED.day_of_month,
    updated_at = now();

INSERT INTO app_metadata (key, value)
VALUES (
    'development_seed',
    jsonb_build_object('status', 'ready', 'demo_user', 'demo@myfinance.local')
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
