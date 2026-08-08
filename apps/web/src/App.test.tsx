import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the Calm Ledger shell and API readiness", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "ok", service: "api", version: "test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    renderApp();

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Your financial home is ready" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("vtest")).toBeInTheDocument();
  });

  it("renders an explicit empty state for cashflow", () => {
    renderApp("/cashflow");

    expect(screen.getByRole("heading", { name: "Cashflow", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nothing here yet" })).toBeInTheDocument();
  });
});
