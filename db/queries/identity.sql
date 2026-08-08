-- name: CreateUser :one
INSERT INTO users (email, display_name, password_hash)
VALUES (sqlc.arg(email), sqlc.arg(display_name), sqlc.arg(password_hash))
RETURNING
    id::text AS id,
    email,
    display_name,
    timezone,
    functional_currency,
    display_currency,
    reconciliation_mode,
    onboarding_completed;

-- name: GetUserForLogin :one
SELECT
    users.id::text AS id,
    users.email,
    users.display_name,
    users.password_hash,
    users.timezone,
    users.functional_currency,
    users.display_currency,
    users.reconciliation_mode,
    users.onboarding_completed,
    (totp_credentials.enabled_at IS NOT NULL)::boolean AS totp_enabled
FROM users
LEFT JOIN totp_credentials ON totp_credentials.user_id = users.id
WHERE users.email = sqlc.arg(email)
LIMIT 1;

-- name: GetUserSecurityForUpdate :one
SELECT id::text AS id, email, display_name, password_hash
FROM users
WHERE id = sqlc.arg(user_id)::uuid
FOR UPDATE;

-- name: CreateSession :one
INSERT INTO sessions (user_id, token_hash, expires_at, user_agent)
VALUES (sqlc.arg(user_id)::uuid, sqlc.arg(token_hash), sqlc.arg(expires_at), sqlc.narg(user_agent))
RETURNING id::text;

-- name: GetUserBySession :one
SELECT
    sessions.id::text AS session_id,
    users.id::text AS id,
    users.email,
    users.display_name,
    users.timezone,
    users.functional_currency,
    users.display_currency,
    users.reconciliation_mode,
    users.onboarding_completed,
    (totp_credentials.enabled_at IS NOT NULL)::boolean AS totp_enabled
FROM sessions
JOIN users ON users.id = sessions.user_id
LEFT JOIN totp_credentials ON totp_credentials.user_id = users.id
WHERE sessions.token_hash = sqlc.arg(token_hash)
  AND sessions.revoked_at IS NULL
  AND sessions.expires_at > now()
LIMIT 1;

-- name: TouchSession :exec
UPDATE sessions
SET last_seen_at = now()
WHERE token_hash = sqlc.arg(token_hash)
  AND last_seen_at < now() - interval '5 minutes';

-- name: RevokeSession :exec
UPDATE sessions
SET revoked_at = now()
WHERE token_hash = sqlc.arg(token_hash)
  AND revoked_at IS NULL;

-- name: ListUserSessions :many
SELECT
    id::text AS id,
    created_at,
    last_seen_at,
    expires_at,
    user_agent,
    token_hash = sqlc.arg(current_token_hash) AS current
FROM sessions
WHERE user_id = sqlc.arg(user_id)::uuid
  AND revoked_at IS NULL
  AND expires_at > now()
ORDER BY current DESC, last_seen_at DESC;

-- name: RevokeUserSession :one
UPDATE sessions
SET revoked_at = now()
WHERE id = sqlc.arg(session_id)::uuid
  AND user_id = sqlc.arg(user_id)::uuid
  AND revoked_at IS NULL
RETURNING token_hash;

-- name: RevokeOtherUserSessions :exec
UPDATE sessions
SET revoked_at = now()
WHERE user_id = sqlc.arg(user_id)::uuid
  AND token_hash <> sqlc.arg(current_token_hash)
  AND revoked_at IS NULL;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions
WHERE expires_at < now() - interval '7 days'
   OR revoked_at < now() - interval '30 days';

-- name: DeleteExpiredLoginChallenges :execrows
DELETE FROM login_challenges
WHERE expires_at < now() - interval '1 day'
   OR consumed_at < now() - interval '1 day';

-- name: UpdateUserProfile :one
UPDATE users
SET email = sqlc.arg(email),
    display_name = sqlc.arg(display_name),
    updated_at = now()
WHERE id = sqlc.arg(user_id)::uuid
RETURNING
    id::text AS id,
    email,
    display_name,
    timezone,
    functional_currency,
    display_currency,
    reconciliation_mode,
    onboarding_completed;

-- name: UpdateUserPassword :exec
UPDATE users
SET password_hash = sqlc.arg(password_hash),
    password_changed_at = now(),
    updated_at = now()
WHERE id = sqlc.arg(user_id)::uuid;

-- name: UpdateUserSettings :one
UPDATE users
SET timezone = sqlc.arg(timezone),
    functional_currency = sqlc.arg(functional_currency),
    display_currency = sqlc.arg(display_currency),
    reconciliation_mode = sqlc.arg(reconciliation_mode),
    updated_at = now()
WHERE id = sqlc.arg(user_id)::uuid
RETURNING
    id::text AS id,
    email,
    display_name,
    timezone,
    functional_currency,
    display_currency,
    reconciliation_mode,
    onboarding_completed;

-- name: DeleteUser :exec
DELETE FROM users WHERE id = sqlc.arg(user_id)::uuid;

-- name: UpsertPendingTOTP :exec
INSERT INTO totp_credentials (user_id, secret_ciphertext)
VALUES (sqlc.arg(user_id)::uuid, sqlc.arg(secret_ciphertext))
ON CONFLICT (user_id) DO UPDATE
SET secret_ciphertext = EXCLUDED.secret_ciphertext,
    enabled_at = NULL,
    last_used_step = -1,
    updated_at = now();

-- name: GetTOTPForUser :one
SELECT secret_ciphertext, enabled_at, last_used_step
FROM totp_credentials
WHERE user_id = sqlc.arg(user_id)::uuid
FOR UPDATE;

-- name: EnableTOTP :exec
UPDATE totp_credentials
SET enabled_at = now(),
    updated_at = now()
WHERE user_id = sqlc.arg(user_id)::uuid
  AND enabled_at IS NULL;

-- name: DisableTOTP :exec
DELETE FROM totp_credentials
WHERE user_id = sqlc.arg(user_id)::uuid;

-- name: DeleteRecoveryCodes :exec
DELETE FROM recovery_codes WHERE user_id = sqlc.arg(user_id)::uuid;

-- name: CreateRecoveryCode :exec
INSERT INTO recovery_codes (user_id, code_hash)
VALUES (sqlc.arg(user_id)::uuid, sqlc.arg(code_hash));

-- name: CountActiveRecoveryCodes :one
SELECT count(*)
FROM recovery_codes
WHERE user_id = sqlc.arg(user_id)::uuid
  AND used_at IS NULL;

-- name: CreateLoginChallenge :exec
INSERT INTO login_challenges (user_id, token_hash, expires_at)
VALUES (sqlc.arg(user_id)::uuid, sqlc.arg(token_hash), sqlc.arg(expires_at));

-- name: GetLoginChallengeForUpdate :one
SELECT
    login_challenges.id::text AS challenge_id,
    login_challenges.user_id::text AS user_id,
    login_challenges.attempts,
    users.email,
    users.display_name,
    users.timezone,
    users.functional_currency,
    users.display_currency,
    users.reconciliation_mode,
    users.onboarding_completed,
    totp_credentials.secret_ciphertext,
    totp_credentials.last_used_step
FROM login_challenges
JOIN users ON users.id = login_challenges.user_id
JOIN totp_credentials ON totp_credentials.user_id = users.id
WHERE login_challenges.token_hash = sqlc.arg(token_hash)
  AND login_challenges.consumed_at IS NULL
  AND login_challenges.expires_at > now()
  AND login_challenges.attempts < 5
  AND totp_credentials.enabled_at IS NOT NULL
FOR UPDATE OF login_challenges, totp_credentials;

-- name: IncrementLoginChallengeAttempts :exec
UPDATE login_challenges
SET attempts = attempts + 1
WHERE id = sqlc.arg(challenge_id)::uuid;

-- name: ConsumeLoginChallenge :exec
UPDATE login_challenges
SET consumed_at = now()
WHERE id = sqlc.arg(challenge_id)::uuid
  AND consumed_at IS NULL;

-- name: UpdateTOTPLastUsedStep :exec
UPDATE totp_credentials
SET last_used_step = sqlc.arg(last_used_step),
    updated_at = now()
WHERE user_id = sqlc.arg(user_id)::uuid
  AND last_used_step < sqlc.arg(last_used_step);

-- name: GetRecoveryCodeForUpdate :one
SELECT id::text AS id
FROM recovery_codes
WHERE user_id = sqlc.arg(user_id)::uuid
  AND code_hash = sqlc.arg(code_hash)
  AND used_at IS NULL
FOR UPDATE;

-- name: UseRecoveryCode :exec
UPDATE recovery_codes
SET used_at = now()
WHERE id = sqlc.arg(recovery_code_id)::uuid
  AND used_at IS NULL;

-- name: CreateAuthAuditEvent :exec
INSERT INTO auth_audit_events (user_id, event_type, success, request_id, metadata)
VALUES (
    sqlc.narg(user_id)::uuid,
    sqlc.arg(event_type),
    sqlc.arg(success),
    sqlc.narg(request_id),
    sqlc.arg(metadata)
);

-- name: LockUserForOnboarding :one
SELECT onboarding_completed
FROM users
WHERE id = sqlc.arg(user_id)::uuid
FOR UPDATE;

-- name: CompleteUserOnboarding :one
UPDATE users
SET timezone = sqlc.arg(timezone),
    functional_currency = sqlc.arg(functional_currency),
    display_currency = sqlc.arg(display_currency),
    reconciliation_mode = sqlc.arg(reconciliation_mode),
    onboarding_completed = true,
    updated_at = now()
WHERE id = sqlc.arg(user_id)::uuid
RETURNING
    id::text AS id,
    email,
    display_name,
    timezone,
    functional_currency,
    display_currency,
    reconciliation_mode,
    onboarding_completed;

-- name: CreateOnboardingAccountSetup :one
INSERT INTO onboarding_account_setups (
    user_id,
    name,
    account_class,
    subtype,
    currency,
    opening_balance,
    opening_balance_date
)
VALUES (
    sqlc.arg(user_id)::uuid,
    sqlc.arg(name),
    sqlc.arg(account_class),
    sqlc.arg(subtype),
    sqlc.arg(currency),
    sqlc.arg(opening_balance),
    sqlc.arg(opening_balance_date)
)
RETURNING id::text;

-- name: CreateOnboardingRecurringIncomeSetup :one
INSERT INTO onboarding_recurring_income_setups (
    user_id,
    name,
    amount,
    currency,
    day_of_month
)
VALUES (
    sqlc.arg(user_id)::uuid,
    sqlc.arg(name),
    sqlc.arg(amount),
    sqlc.arg(currency),
    sqlc.arg(day_of_month)
)
RETURNING id::text;
