# ADR 0002: Immutable ledger with balance-snapshot reconciliation

- Status: Accepted
- Date: 2026-08-08

## Context

The product must estimate spending without requiring itemised purchase entry while still preserving complete double-entry accounting.

## Decision

All posted financial events are immutable typed transactions with at least two entries. Entries balance in the user's functional currency. UI edit and delete actions create reversals and corrected replacements.

Reconciliation compares each reported account balance with the account's ledger balance at month-end:

`difference = reported balance - ledger balance`

- Negative difference: post `Other Expense` against the account.
- Positive difference: post `Other Income` against the account.
- A repeated reconciliation reverses its prior adjustment before posting the replacement.

The reconciliation reminder is a soft window from five days before month-end through the fifth day of the next month. Accounts may be reconciled independently. A multi-month gap is posted into the latest reconciled month and labelled as covering the gap.

An asset acquisition is a cash outflow in product savings metrics but a transfer from cash to an asset in the ledger.

## Consequences

- The application can calculate total unexplained spending but cannot infer detailed categories.
- Historical corrections remain auditable.
- Month-end statistics may be intentionally distorted when a user assigns a multi-month gap to the latest month; the UI must disclose this.
- Functional and account currencies become immutable after first use.
