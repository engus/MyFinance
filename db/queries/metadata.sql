-- name: GetAppMetadata :one
SELECT key, value, updated_at
FROM app_metadata
WHERE key = $1;

-- name: UpsertAppMetadata :one
INSERT INTO app_metadata (key, value)
VALUES ($1, $2)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now()
RETURNING key, value, updated_at;
