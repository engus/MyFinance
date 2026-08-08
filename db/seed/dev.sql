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

-- A compact, deterministic ledger story for local product review.
BEGIN;

INSERT INTO ledger_accounts (id, user_id, name, account_class, subtype, role, currency, system_code)
VALUES
    ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', 'Opening balance equity', 'EQUITY', 'equity', 'SYSTEM', 'USD', 'OPENING_EQUITY'),
    ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', 'Other income', 'INCOME', 'category', 'SYSTEM', 'USD', 'OTHER_INCOME'),
    ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', 'Other expense', 'EXPENSE', 'category', 'SYSTEM', 'USD', 'OTHER_EXPENSE')
ON CONFLICT (user_id, system_code) WHERE system_code IS NOT NULL DO NOTHING;

INSERT INTO ledger_accounts (id, user_id, name, account_class, subtype, role, currency)
VALUES
    ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000001', 'Salary', 'INCOME', 'category', 'CATEGORY', 'USD'),
    ('00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000001', 'Housing', 'EXPENSE', 'category', 'CATEGORY', 'USD'),
    ('00000000-0000-4000-8000-000000000206', '00000000-0000-4000-8000-000000000001', 'Everyday', 'EXPENSE', 'category', 'CATEGORY', 'USD'),
    ('00000000-0000-4000-8000-000000000207', '00000000-0000-4000-8000-000000000001', 'Primary checking', 'ASSET', 'bank', 'USER', 'USD'),
    ('00000000-0000-4000-8000-000000000208', '00000000-0000-4000-8000-000000000001', 'Savings', 'ASSET', 'bank', 'USER', 'USD')
ON CONFLICT (id) DO NOTHING;

INSERT INTO categories (id, user_id, name, direction, ledger_account_id)
VALUES
    ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', 'Salary', 'INCOME', '00000000-0000-4000-8000-000000000204'),
    ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', 'Housing', 'EXPENSE', '00000000-0000-4000-8000-000000000205'),
    ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000001', 'Everyday', 'EXPENSE', '00000000-0000-4000-8000-000000000206')
ON CONFLICT (id) DO NOTHING;

INSERT INTO recurring_templates (
    id, user_id, name, operation_type, amount, currency, description,
    account_id, category_id, frequency, interval_unit, interval_count,
    start_date, next_scheduled_date
)
VALUES
    (
        '00000000-0000-4000-8000-000000000102',
        '00000000-0000-4000-8000-000000000001',
        'Monthly salary', 'INCOME', 4800, 'USD', 'Expected monthly salary',
        '00000000-0000-4000-8000-000000000207',
        '00000000-0000-4000-8000-000000000301',
        'MONTHLY', 'MONTHS', 1, DATE '2026-09-25', DATE '2026-09-25'
    ),
    (
        '00000000-0000-4000-8000-000000000103',
        '00000000-0000-4000-8000-000000000001',
        'Monthly rent', 'EXPENSE', 1450, 'USD', 'Expected monthly rent',
        '00000000-0000-4000-8000-000000000207',
        '00000000-0000-4000-8000-000000000302',
        'MONTHLY', 'MONTHS', 1, DATE '2026-09-01', DATE '2026-09-01'
    )
ON CONFLICT (id) DO NOTHING;

UPDATE onboarding_recurring_income_setups
SET materialized_at = COALESCE(materialized_at, now()), updated_at = now()
WHERE id = '00000000-0000-4000-8000-000000000102';

INSERT INTO reconciliations (
    id, user_id, account_id, period_end, reported_balance, ledger_balance_before,
    net_difference, adjustment_amount, gap_months, idempotency_key
)
VALUES
    (
        '00000000-0000-4000-8000-000000000601',
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000207',
        DATE '2026-07-31', 0, 0, 0, 0, 1,
        '00000000-0000-4000-8000-000000000601'
    ),
    (
        '00000000-0000-4000-8000-000000000602',
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000208',
        DATE '2026-07-31', 0, 0, 0, 0, 1,
        '00000000-0000-4000-8000-000000000602'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO balance_snapshots (
    id, user_id, account_id, reconciliation_id, period_end, reported_balance, currency
)
VALUES
    (
        '00000000-0000-4000-8000-000000000701',
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000207',
        '00000000-0000-4000-8000-000000000601',
        DATE '2026-07-31', 0, 'USD'
    ),
    (
        '00000000-0000-4000-8000-000000000702',
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000208',
        '00000000-0000-4000-8000-000000000602',
        DATE '2026-07-31', 0, 'USD'
    )
ON CONFLICT (id) DO NOTHING;

UPDATE onboarding_account_setups
SET ledger_account_id = '00000000-0000-4000-8000-000000000207', updated_at = now()
WHERE user_id = '00000000-0000-4000-8000-000000000001' AND ledger_account_id IS NULL;

INSERT INTO ledger_transactions (id, user_id, transaction_type, event_date, description, idempotency_key)
VALUES
    ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', 'OPENING_BALANCE', DATE '2026-08-01', 'Starting balance', '00000000-0000-4000-8000-000000000101'),
    ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001', 'INCOME', DATE '2026-08-03', 'August salary', '00000000-0000-4000-8000-000000000402'),
    ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000001', 'EXPENSE', DATE '2026-08-05', 'Monthly rent', '00000000-0000-4000-8000-000000000403'),
    ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000001', 'EXPENSE', DATE '2026-08-07', 'Groceries', '00000000-0000-4000-8000-000000000404'),
    ('00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000001', 'TRANSFER', DATE '2026-08-08', 'Move to savings', '00000000-0000-4000-8000-000000000405')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ledger_entries (id, transaction_id, user_id, account_id, category_id, original_amount, currency, functional_amount, fx_rate, fx_source, fx_date)
SELECT entry.id, entry.transaction_id, '00000000-0000-4000-8000-000000000001', entry.account_id, entry.category_id,
       entry.amount, 'USD', entry.amount, 1, 'IDENTITY', entry.event_date
FROM (VALUES
    ('00000000-0000-4000-8000-000000000501'::uuid, '00000000-0000-4000-8000-000000000401'::uuid, '00000000-0000-4000-8000-000000000207'::uuid, NULL::uuid, 12450.75::numeric, DATE '2026-08-01'),
    ('00000000-0000-4000-8000-000000000502'::uuid, '00000000-0000-4000-8000-000000000401'::uuid, '00000000-0000-4000-8000-000000000201'::uuid, NULL::uuid, -12450.75::numeric, DATE '2026-08-01'),
    ('00000000-0000-4000-8000-000000000503'::uuid, '00000000-0000-4000-8000-000000000402'::uuid, '00000000-0000-4000-8000-000000000207'::uuid, NULL::uuid, 4800::numeric, DATE '2026-08-03'),
    ('00000000-0000-4000-8000-000000000504'::uuid, '00000000-0000-4000-8000-000000000402'::uuid, '00000000-0000-4000-8000-000000000204'::uuid, '00000000-0000-4000-8000-000000000301'::uuid, -4800::numeric, DATE '2026-08-03'),
    ('00000000-0000-4000-8000-000000000505'::uuid, '00000000-0000-4000-8000-000000000403'::uuid, '00000000-0000-4000-8000-000000000207'::uuid, NULL::uuid, -1450::numeric, DATE '2026-08-05'),
    ('00000000-0000-4000-8000-000000000506'::uuid, '00000000-0000-4000-8000-000000000403'::uuid, '00000000-0000-4000-8000-000000000205'::uuid, '00000000-0000-4000-8000-000000000302'::uuid, 1450::numeric, DATE '2026-08-05'),
    ('00000000-0000-4000-8000-000000000507'::uuid, '00000000-0000-4000-8000-000000000404'::uuid, '00000000-0000-4000-8000-000000000207'::uuid, NULL::uuid, -126.40::numeric, DATE '2026-08-07'),
    ('00000000-0000-4000-8000-000000000508'::uuid, '00000000-0000-4000-8000-000000000404'::uuid, '00000000-0000-4000-8000-000000000206'::uuid, '00000000-0000-4000-8000-000000000303'::uuid, 126.40::numeric, DATE '2026-08-07'),
    ('00000000-0000-4000-8000-000000000509'::uuid, '00000000-0000-4000-8000-000000000405'::uuid, '00000000-0000-4000-8000-000000000207'::uuid, NULL::uuid, -2000::numeric, DATE '2026-08-08'),
    ('00000000-0000-4000-8000-000000000510'::uuid, '00000000-0000-4000-8000-000000000405'::uuid, '00000000-0000-4000-8000-000000000208'::uuid, NULL::uuid, 2000::numeric, DATE '2026-08-08')
) AS entry(id, transaction_id, account_id, category_id, amount, event_date)
JOIN ledger_transactions transaction ON transaction.id = entry.transaction_id AND transaction.posted_at IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE ledger_transactions SET posted_at = now()
WHERE id IN (
    '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000402',
    '00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000404',
    '00000000-0000-4000-8000-000000000405'
) AND posted_at IS NULL;

UPDATE onboarding_account_setups
SET ledger_posted_at = COALESCE(ledger_posted_at, now()), updated_at = now()
WHERE user_id = '00000000-0000-4000-8000-000000000001';

COMMIT;

INSERT INTO app_metadata (key, value)
VALUES (
    'development_seed',
    jsonb_build_object('status', 'ready', 'demo_user', 'demo@myfinance.local')
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
