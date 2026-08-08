# MyFinance v1 — Product Brief

## Product goal

Build a simple personal finance web application for individuals or families who want to understand their cashflow and net worth without recording every purchase.

The target user may hold between USD 10,000 and USD 20 million across multiple countries, currencies, and institutions. One account manages one family's finances in v1.

The application should answer four questions with minimal manual work:

1. How much money came in?
2. How much money was spent?
3. How much was saved or lost during the month?
4. What are the user's accounts and assets worth today?

## Cashflow model

The user creates bank, debit-card, and cash accounts, selects a currency for each account, and records an opening balance.

The user records known income, expenses, transfers, and asset purchases. Operations may be one-off or recurring. Recurring operations are posted automatically according to weekly, monthly, quarterly, yearly, or custom schedules and can later be corrected or reversed.

At the end of a month, the user enters the reported balance of one or more accounts through Reconciliation. For every account:

`difference = reported month-end balance - ledger balance`

- A negative difference creates `Other Expense`.
- A positive difference creates `Other Income`.
- Known operations are already included and are not counted twice.
- Accounts may be reconciled independently. The month remains incomplete until all active accounts are updated.

A soft reconciliation prompt appears from five calendar days before month-end through the fifth day of the following month, using the user's profile timezone. Reconciliation remains available outside this window.

Balances entered inside the window are treated as balances for the target month's final calendar day. Repeating a reconciliation reverses the previous adjustment and creates a corrected version.

If balances were not updated for several months, the user may enter a new balance without reconstructing every missed month. The full unexplained difference is assigned to the latest reconciled month and is marked as covering a multi-month gap.

The application derives total unexplained spending but does not invent categories such as groceries, restaurants, or transport. Detailed categorisation is available only for manually recorded operations.

## Accounting model

Use immutable double-entry accounting:

- Every posted transaction contains at least two entries.
- Every transaction balances in the user's functional currency.
- Opening balances, income, expenses, transfers, asset purchases, reconciliation adjustments, revaluations, and reversals use typed operations.
- Editing or deleting a posted operation creates a reversal and a corrected replacement.
- Account currency cannot change after the account's first posting.
- Functional currency cannot change after the user's first posting.
- Display currency may be changed at any time.
- Monetary values are stored and transferred as decimal strings, never binary floating-point numbers.

An asset purchase is a cash outflow for monthly expenses, net cash savings, and savings rate, while the accounting entry moves value from cash into an asset. It reduces liquid savings but does not immediately destroy net worth.

## Monthly metrics

- `Total income`: income operations plus derived Other Income.
- `Total expenses`: ordinary expenses, derived Other Expense, and asset-purchase cash outflows. Internal transfers are excluded.
- `Net savings`: total income minus total expenses.
- `Savings rate`: net savings divided by total income. It is unavailable when income is zero.
- `Net worth`: reconciled cash balances plus the latest asset valuations. Liabilities are deferred from v1.

## Assets

Support manual asset profiles for:

- real estate;
- vehicles;
- businesses;
- manually valued securities portfolios;
- collectibles;
- other assets.

Each asset stores its currency, country, region, institution, ownership percentage, notes, and dated manual valuation history.

Automated security prices, ticker positions, and tax lots are deferred.

## Currencies and FX

Support these 24 currencies:

`USD, EUR, JPY, GBP, CNY, AUD, CAD, CHF, HKD, SGD, SEK, KRW, NOK, NZD, INR, MXN, TWD, ZAR, BRL, DKK, KZT, RUB, UAH, AED`.

Each user has one functional currency and one changeable display currency.

A separate Go worker fetches Yahoo Finance currency data on startup and once daily, stores dated FX snapshots, and performs historical backfills when required. Yahoo must be isolated behind a replaceable provider interface because its unofficial endpoints may change or become unavailable.

Successful rates are cached. A failed refresh uses the latest available rate and marks it as stale. If no rate has ever been obtained, the affected amount is excluded from converted totals and the UI shows an explicit warning. Manual FX entry is not part of v1.

## Pages

- Login and registration.
- Onboarding: timezone, functional/display currency, first accounts, opening balances, and recurring income.
- Dashboard: balances, income, expenses, net savings, savings rate, assets, net worth, and historical charts.
- Cashflow: accounts, operations, recurring templates, filters, and Reconciliation.
- Assets: asset profiles and valuation history.
- Settings: profile, currencies, timezone, security, sessions, export, and account deletion.

All UI copy and documentation must be written in English. UI strings must live in localisation resources so additional languages can be added later.

The accepted visual direction is `Calm Ledger`: a light neutral canvas, white elevated surfaces, navy typography, indigo primary actions, restrained semantic financial colours, compact analytical cards, a desktop sidebar, and mobile bottom navigation. The UI must provide visible keyboard focus and explicit loading, empty, error, stale-data, and reconciliation states. A theme or design-variant switch is not part of v1.

## Authentication, privacy, and ownership

- Email/password registration and login using Argon2id.
- Secure database-backed sessions delivered through HttpOnly, SameSite cookies.
- CSRF protection and authentication rate limits.
- Optional TOTP 2FA with encrypted secrets and hashed recovery codes.
- Session list and revocation.
- Email/password editing and password-confirmed account deletion.
- Complete JSON backup and resource-specific CSV exports.
- Strict ownership isolation between users.
- Structured logs without financial values, credentials, or tokens.
- Audit records for authentication, financial corrections, and administrative access.

The server is allowed to process readable financial data. During development, Adminer may inspect and edit all database tables, but it must bind only to `127.0.0.1` and must never be included in a production configuration.

## Technical direction

- Frontend: React 19, TypeScript, and Vite 7.3.
- Backend: Go 1.25.x with `chi` and a REST API defined by OpenAPI 3.1.
- Database: PostgreSQL 17 with explicit SQL migrations, `pgx/v5`, and `sqlc`.
- Local environment: Docker Compose with web, API, worker, development database, test database, and loopback-only Adminer.
- One command must start the complete local application.
- Use stable supported releases and avoid prerelease or experimental framework features.
- Create an isolated test database, an idempotent demo user, and representative dummy data.
- Test the core accounting, reconciliation, recurrence, currency, ownership, and security rules.
- Implement the approved `Calm Ledger` desktop/mobile design direction.
- Deliver one reviewed pull request per milestone.

## Deferred features

- Production deployment and production admin panel.
- Liabilities, loans, and mortgages.
- Google authentication.
- Email verification and password reset.
- Bank and broker imports.
- Automated security quotes.
- Household invitations and roles.
- iOS and Android clients.
- Additional UI languages.
- Dark theme.
- Manual FX rates.
