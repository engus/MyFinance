import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function renderApp(path = "/dashboard") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/v1/auth/me")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                user: {
                  id: "00000000-0000-4000-8000-000000000001",
                  email: "demo@myfinance.local",
                  displayName: "Demo User",
                  timezone: "Asia/Almaty",
                  functionalCurrency: "USD",
                  displayCurrency: "USD",
                  reconciliationMode: "CONFIRM",
                  onboardingCompleted: true,
                  totpEnabled: false,
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        if (url.includes("/api/v1/dashboard")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                currency: "USD",
                month: "2026-08",
                fxStatus: { state: "COMPLETE", missingCurrencies: [], staleCurrencies: [] },
                netWorth: "0",
                assets: "0",
                liabilities: "0",
                cash: "0",
                monthlyIncome: "0",
                monthlyExpenses: "0",
                netSavings: "0",
                savingsRate: "",
                netWorthHistory: [],
                cashflowHistory: [],
                assetAllocation: [],
                currencyExposure: [],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        if (url.includes("/api/v1/accounts")) {
          return Promise.resolve(
            new Response(JSON.stringify({ accounts: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        if (url.includes("/api/v1/categories")) {
          return Promise.resolve(
            new Response(JSON.stringify({ categories: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        if (url.includes("/api/v1/transactions")) {
          return Promise.resolve(
            new Response(JSON.stringify({ transactions: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ status: "ok", service: "api", version: "test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the Calm Ledger dashboard without developer-only service status", async () => {
    renderApp();

    expect(
      await screen.findByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Your money, in one clear view." }),
    ).toBeInTheDocument();
    expect(screen.queryByText("API readiness")).not.toBeInTheDocument();
    expect(screen.queryByText("vtest")).not.toBeInTheDocument();
  });

  it("renders an explicit empty state for cashflow", async () => {
    renderApp("/cashflow");

    expect(await screen.findByRole("heading", { name: "Cashflow", level: 2 })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Nothing here yet" })).toBeInTheDocument();
  });

  it("preserves an exact decimal string when posting an expense", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/auth/me")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: {
                id: "00000000-0000-4000-8000-000000000001",
                email: "demo@myfinance.local",
                displayName: "Demo User",
                timezone: "UTC",
                functionalCurrency: "USD",
                displayCurrency: "USD",
                reconciliationMode: "CONFIRM",
                onboardingCompleted: true,
                totpEnabled: false,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/v1/accounts")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accounts: [
                {
                  id: "00000000-0000-4000-8000-000000000207",
                  name: "Primary checking",
                  accountClass: "ASSET",
                  subtype: "bank",
                  currency: "USD",
                  balance: "1000.00000000",
                  archived: false,
                  hasPostings: true,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/v1/categories")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              categories: [
                {
                  id: "00000000-0000-4000-8000-000000000303",
                  name: "Everyday",
                  direction: "EXPENSE",
                  archived: false,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.endsWith("/api/v1/transactions") && init?.method === "POST") {
        const request = JSON.parse(String(init.body));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "00000000-0000-4000-8000-000000000499",
              type: "EXPENSE",
              eventDate: request.eventDate,
              amount: request.amount,
              currency: "USD",
              primaryAccountName: "Primary checking",
              status: "POSTED",
              postedAt: "2026-08-09T00:00:00Z",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/v1/transactions")) {
        return Promise.resolve(
          new Response(JSON.stringify({ transactions: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ status: "ok", service: "api", version: "test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp("/cashflow");
    const newOperation = await screen.findByRole("button", { name: "New operation" });
    await waitFor(() => expect(newOperation).toBeEnabled());
    fireEvent.click(newOperation);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Amount"), {
      target: { value: "123.45000000" },
    });
    fireEvent.change(within(dialog).getByLabelText("Category"), {
      target: { value: "00000000-0000-4000-8000-000000000303" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post operation" }));

    await screen.findByRole("heading", { name: "Nothing here yet" });
    const operationCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/api/v1/transactions") && init?.method === "POST",
    );
    expect(JSON.parse(String(operationCall?.[1]?.body)).amount).toBe("123.45000000");
  });

  it("previews reconciliation without changing the reported decimal string", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/auth/me")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: {
                id: "00000000-0000-4000-8000-000000000001",
                email: "demo@myfinance.local",
                displayName: "Demo User",
                timezone: "UTC",
                functionalCurrency: "USD",
                displayCurrency: "USD",
                reconciliationMode: "CONFIRM",
                onboardingCompleted: true,
                totpEnabled: false,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/v1/accounts")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accounts: [
                {
                  id: "00000000-0000-4000-8000-000000000207",
                  name: "Primary checking",
                  accountClass: "ASSET",
                  subtype: "bank",
                  currency: "USD",
                  balance: "1000.00000000",
                  archived: false,
                  hasPostings: true,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/v1/categories")) {
        return Promise.resolve(
          new Response(JSON.stringify({ categories: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/api/v1/transactions")) {
        return Promise.resolve(
          new Response(JSON.stringify({ transactions: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/api/v1/reconciliation/status")) {
        const requestedPeriodEnd =
          new URL(url, "http://localhost").searchParams.get("periodEnd") ?? "2026-08-31";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              today: "2026-08-28",
              suggestedPeriodEnd: "2026-08-31",
              periodEnd: requestedPeriodEnd,
              promptOpen: true,
              promptStart: "2026-08-26",
              promptEnd: "2026-09-05",
              complete: false,
              accounts: [
                {
                  accountId: "00000000-0000-4000-8000-000000000207",
                  accountName: "Primary checking",
                  currency: "USD",
                  ledgerBalance: "1000.00000000",
                  status: "PENDING",
                  gapMonths: 1,
                  multiMonthGap: false,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.endsWith("/api/v1/reconciliation/prepare") && init?.method === "POST") {
        const request = JSON.parse(String(init.body));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              outcome: "PREVIEW",
              preview: {
                id: "00000000-0000-4000-8000-000000000601",
                accountId: request.accountId,
                accountName: "Primary checking",
                currency: "USD",
                periodEnd: request.periodEnd,
                reportedBalance: request.reportedBalance,
                ledgerBalance: "1000.00000000",
                difference: "-99.87500000",
                direction: "OTHER_EXPENSE",
                gapMonths: 1,
                multiMonthGap: false,
                expiresAt: "2026-08-28T12:15:00Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ templates: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp("/cashflow?tab=reconciliation");
    fireEvent.change(await screen.findByLabelText("Month"), {
      target: { value: "2026-07" },
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes("periodEnd=2026-07-31")),
      ).toBe(true),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Update balance" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Balance reported by the institution"), {
      target: { value: "900.12500000" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Review difference" }));
    expect(await within(dialog).findByText("Other Expense: 99.87500000 USD")).toBeInTheDocument();
    const prepareCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/v1/reconciliation/prepare"),
    );
    expect(JSON.parse(String(prepareCall?.[1]?.body)).reportedBalance).toBe("900.12500000");
    expect(JSON.parse(String(prepareCall?.[1]?.body)).periodEnd).toBe("2026-07-31");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates a monthly recurring operation from Cashflow", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/auth/me")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: {
                id: "00000000-0000-4000-8000-000000000001",
                email: "demo@myfinance.local",
                displayName: "Demo User",
                timezone: "UTC",
                functionalCurrency: "USD",
                displayCurrency: "USD",
                reconciliationMode: "CONFIRM",
                onboardingCompleted: true,
                totpEnabled: false,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/v1/accounts")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accounts: [
                {
                  id: "00000000-0000-4000-8000-000000000207",
                  name: "Primary checking",
                  accountClass: "ASSET",
                  subtype: "bank",
                  currency: "USD",
                  balance: "1000.00000000",
                  archived: false,
                  hasPostings: true,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/v1/categories")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              categories: [
                {
                  id: "00000000-0000-4000-8000-000000000303",
                  name: "Everyday",
                  direction: "EXPENSE",
                  archived: false,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/v1/transactions")) {
        return Promise.resolve(
          new Response(JSON.stringify({ transactions: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/api/v1/reconciliation/status")) {
        return Promise.resolve(
          new Response(JSON.stringify({ promptOpen: false, complete: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.endsWith("/api/v1/recurring-templates") && init?.method === "POST") {
        const request = JSON.parse(String(init.body));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "00000000-0000-4000-8000-000000000701",
              ...request,
              currency: "USD",
              intervalUnit: "MONTHS",
              intervalCount: 1,
              nextScheduledDate: request.startDate,
              status: "ACTIVE",
              archived: false,
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/v1/recurring-templates")) {
        return Promise.resolve(
          new Response(JSON.stringify({ templates: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp("/cashflow");
    fireEvent.click(await screen.findByRole("button", { name: "Recurring" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add recurring operation" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Template name"), {
      target: { value: "Monthly rent" },
    });
    fireEvent.change(within(dialog).getByLabelText("Amount"), {
      target: { value: "1450.50000000" },
    });
    fireEvent.change(within(dialog).getByLabelText("Category"), {
      target: { value: "00000000-0000-4000-8000-000000000303" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save template" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/v1/recurring-templates") && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/api/v1/recurring-templates") && init?.method === "POST",
    );
    expect(JSON.parse(String(createCall?.[1]?.body)).amount).toBe("1450.50000000");
  });

  it("redirects an unauthenticated visitor to the demo login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "authentication_required", message: "Sign in" } }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    renderApp("/dashboard");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("demo@myfinance.local")).toBeInTheDocument();
  });

  it("fills and submits the documented demo credentials", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith("/api/v1/auth/me")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: "authentication_required", message: "Sign in" } }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.endsWith("/api/v1/auth/login")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: {
                id: "00000000-0000-4000-8000-000000000001",
                email: "demo@myfinance.local",
                displayName: "Demo User",
                timezone: "Asia/Almaty",
                functionalCurrency: "USD",
                displayCurrency: "USD",
                reconciliationMode: "CONFIRM",
                onboardingCompleted: true,
                totpEnabled: false,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ status: "ok", service: "api", version: "test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Fill demo credentials" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/v1/auth/login"),
    );
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({
      email: "demo@myfinance.local",
      password: "DemoFinance2026!",
    });
  });

  it("registers and preserves decimal strings through onboarding", async () => {
    const pendingUser = {
      id: "10000000-0000-4000-8000-000000000001",
      email: "new.user@example.com",
      displayName: "New User",
      timezone: "UTC",
      functionalCurrency: "USD",
      displayCurrency: "USD",
      reconciliationMode: "CONFIRM",
      onboardingCompleted: false,
      totpEnabled: false,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith("/api/v1/auth/me")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: "authentication_required", message: "Sign in" } }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.endsWith("/api/v1/auth/register")) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: pendingUser }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.endsWith("/api/v1/onboarding/complete")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: { ...pendingUser, onboardingCompleted: true },
              accountSetupId: "10000000-0000-4000-8000-000000000101",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ status: "ok", service: "api", version: "test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp("/register");
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new.user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "A-strong-password-2026" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "A-strong-password-2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByRole("heading", { name: "Set your financial starting point" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Opening balance"), {
      target: { value: "1250000.12500000" },
    });
    fireEvent.click(screen.getByLabelText("Add a monthly recurring income template"));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "850000.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete setup" }));

    expect(
      await screen.findByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    const onboardingCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/v1/onboarding/complete"),
    );
    const payload = JSON.parse(String(onboardingCall?.[1]?.body));
    expect(payload.account.openingBalance).toBe("1250000.12500000");
    expect(payload.recurringIncome.amount).toBe("850000.50");
  });

  it("completes a TOTP login challenge", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/auth/me")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: "authentication_required", message: "Sign in" } }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.endsWith("/api/v1/auth/login")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "totp_required",
              challengeToken: "challenge-token-that-is-long-enough-for-the-api",
              expiresInSeconds: 300,
            }),
            { status: 202, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.endsWith("/api/v1/auth/login/totp")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: {
                id: "00000000-0000-4000-8000-000000000001",
                email: "demo@myfinance.local",
                displayName: "Demo User",
                timezone: "Asia/Almaty",
                functionalCurrency: "USD",
                displayCurrency: "USD",
                reconciliationMode: "CONFIRM",
                onboardingCompleted: true,
                totpEnabled: true,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ status: "ok", service: "api", version: "test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Fill demo credentials" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByRole("heading", { name: "Two-factor verification" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));

    expect(
      await screen.findByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
  });
});
