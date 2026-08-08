-- name: GetUserForLogin :one
SELECT
    id::text AS id,
    email,
    display_name,
    password_hash,
    timezone,
    functional_currency,
    display_currency,
    onboarding_completed
FROM users
WHERE email = sqlc.arg(email)
LIMIT 1;

-- name: CreateSession :exec
INSERT INTO sessions (user_id, token_hash, expires_at, user_agent)
VALUES (sqlc.arg(user_id)::uuid, sqlc.arg(token_hash), sqlc.arg(expires_at), sqlc.narg(user_agent));

-- name: GetUserBySession :one
SELECT
    users.id::text AS id,
    users.email,
    users.display_name,
    users.timezone,
    users.functional_currency,
    users.display_currency,
    users.onboarding_completed
FROM sessions
JOIN users ON users.id = sessions.user_id
WHERE sessions.token_hash = sqlc.arg(token_hash)
  AND sessions.revoked_at IS NULL
  AND sessions.expires_at > now()
LIMIT 1;

-- name: RevokeSession :exec
UPDATE sessions
SET revoked_at = now()
WHERE token_hash = sqlc.arg(token_hash)
  AND revoked_at IS NULL;
