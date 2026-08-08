import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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
                  onboardingCompleted: true,
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
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the Calm Ledger shell and API readiness", async () => {
    renderApp();

    expect(
      await screen.findByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Your financial home is ready" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("vtest")).toBeInTheDocument();
  });

  it("renders an explicit empty state for cashflow", async () => {
    renderApp("/cashflow");

    expect(await screen.findByRole("heading", { name: "Cashflow", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nothing here yet" })).toBeInTheDocument();
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
                onboardingCompleted: true,
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
});
