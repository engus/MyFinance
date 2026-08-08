# ADR 0004: Calm Ledger visual system

## Status

Accepted on 2026-08-09.

## Context

Milestone 0 explored two visual directions over the same Dashboard, Cashflow, Assets, Settings, and
reconciliation information architecture. The product needs to remain calm and trustworthy while
presenting dense financial information on both desktop and mobile.

## Decision

Use the Calm Ledger direction as the sole implementation target:

- light neutral canvas with white elevated surfaces;
- navy typography and indigo primary actions;
- restrained semantic green, red, and amber states;
- rounded analytical cards and compact financial lists;
- desktop sidebar that becomes a mobile bottom navigation;
- centralised English copy and reusable design tokens from the first React component.

The implementation must include visible keyboard focus, reduced-motion support, labelled controls,
and dedicated loading, empty, error, and stale-data states.

## Consequences

- The React design system will not include a theme or visual-variant switch.
- The rejected Private Wealth direction remains available through Git history only.
- Future UI milestones must use this ADR and the selected preview as their visual acceptance
  baseline.
