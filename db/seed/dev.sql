INSERT INTO app_metadata (key, value)
VALUES (
    'development_seed',
    jsonb_build_object('status', 'ready', 'demo_user', 'planned_for_identity_milestone')
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
