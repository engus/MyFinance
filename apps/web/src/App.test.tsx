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
      screen.getByRole("heading", { name: "Your financial ledger is ready" }),
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
