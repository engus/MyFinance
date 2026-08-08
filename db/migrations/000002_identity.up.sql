CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    timezone text NOT NULL DEFAULT 'UTC',
    functional_currency char(3) NOT NULL DEFAULT 'USD',
    display_currency char(3) NOT NULL DEFAULT 'USD',
    onboarding_completed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email))),
    CONSTRAINT users_email_not_empty CHECK (length(email) > 3),
    CONSTRAINT users_display_name_not_empty CHECK (length(btrim(display_name)) > 0)
);

CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT sessions_token_hash_sha256 CHECK (octet_length(token_hash) = 32)
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_active_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

COMMENT ON TABLE users IS 'Application identities with normalized email addresses and Argon2id password hashes.';
COMMENT ON TABLE sessions IS 'Database-backed sessions; only a SHA-256 digest of the browser token is stored.';
