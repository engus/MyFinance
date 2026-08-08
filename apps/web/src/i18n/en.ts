export const en = {
  app: {
    name: "MyFinance",
    privateWorkspace: "Private workspace",
    localOnly: "Local development",
  },
  nav: {
    dashboard: "Dashboard",
    cashflow: "Cashflow",
    assets: "Assets",
    settings: "Settings",
  },
  dashboard: {
    eyebrow: "Foundation milestone",
    title: "Your financial home is ready",
    description:
      "The Calm Ledger shell is connected to a generated API contract. Financial data arrives in the next milestones.",
    apiStatus: "API readiness",
    netWorth: "Net worth",
    income: "Monthly income",
    expenses: "Monthly expenses",
    savingsRate: "Savings rate",
    pending: "Waiting for ledger",
  },
  states: {
    loading: "Checking local services…",
    ready: "Ready",
    unavailable: "Unavailable",
    retry: "Try again",
    emptyTitle: "Nothing here yet",
  },
  cashflow: {
    title: "Cashflow",
    description: "Accounts, recurring income, expenses, and reconciliation will live here.",
    empty: "Create your first account during onboarding in the identity milestone.",
  },
  assets: {
    title: "Assets",
    description: "Track properties, vehicles, businesses, and manually valued portfolios.",
    empty: "Manual valuation snapshots arrive in the assets milestone.",
  },
  settings: {
    title: "Settings",
    description: "Profile, currencies, timezone, security, sessions, and data ownership.",
    environment: "Environment",
    version: "Application version",
    functionalCurrency: "Functional currency",
    timezone: "Timezone",
  },
} as const;
