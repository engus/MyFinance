# MyFinance production runbook

## Deployment

1. Generate independent high-entropy PostgreSQL and TOTP encryption secrets. A valid TOTP key is
   exactly 32 random bytes encoded as base64.
2. Copy `.env.production.example` outside source control and replace every placeholder. URL-encode
   the database password inside `DATABASE_URL`.
3. Terminate HTTPS at a trusted external proxy and forward traffic only to the web container.
4. Start the stack:

   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
   ```

The `migrate` job must finish successfully before the API starts. Check readiness with
`curl -fsS http://127.0.0.1:8080/healthz` and inspect API readiness from the Docker network when
diagnosing database connectivity.

## Backup

Create an encrypted, compressed logical backup at least daily and before every upgrade:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump --format=custom --no-owner --no-acl \
  --username "$POSTGRES_USER" "$POSTGRES_DB" > myfinance-$(date +%F).dump
```

Move the dump to encrypted off-host storage, apply retention policy, and test restoration at least
quarterly. A backup is not considered valid until a restore has succeeded.

## Restore drill

Restore into a new, empty database; never overwrite the live database during a drill:

```bash
createdb myfinance_restore
pg_restore --exit-on-error --no-owner --no-acl --dbname myfinance_restore myfinance-YYYY-MM-DD.dump
```

Point a temporary API instance at the restored database, run `/ready`, sign in with a controlled
test account, and verify account balances plus the functional sum of every transaction. Destroy the
temporary database after validation.

## Upgrade and rollback

1. Back up the database and record the running image digests.
2. Build and scan new images, run CI, then execute the migration job.
3. Deploy API and web images and verify health, login, dashboard, and one reversible posting.
4. Application images can roll back to their previous digest. Database migrations in this project
   are forward-only; restore the pre-upgrade backup if a migration itself must be undone.

## Secret rotation

- Rotate database credentials in PostgreSQL, then atomically replace `DATABASE_URL` and restart the
  migration/API services.
- Rotating `TOTP_ENCRYPTION_KEY` invalidates encrypted authenticator secrets. Plan a controlled
  re-encryption migration before changing it; do not simply replace the key.
- Revoking a user session deletes its hashed opaque token. Password/email changes revoke every
  other active session.

## Incident checks

- Correlate logs with `x-request-id`; logs never include passwords, cookies, TOTP secrets, or raw
  session tokens.
- If Yahoo FX is unavailable, keep the service online. Existing snapshots remain usable and users
  can enter manual dated rates. Investment values are always manual dated snapshots.
- If readiness fails, stop write traffic, inspect PostgreSQL health and migration status, and avoid
  retrying destructive database commands.
