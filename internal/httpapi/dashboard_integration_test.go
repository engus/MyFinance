package httpapi

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/engus/myfinance/internal/api"
	"github.com/google/uuid"
)

func TestDashboardUsesLedgerFlowsAndExcludesTransfersIntegration(t *testing.T) {
	suite := newIdentityIntegration(t)
	email := fmt.Sprintf("dashboard-%d@integration.myfinance.local", time.Now().UnixNano())
	t.Cleanup(func() { _, _ = suite.pool.Exec(context.Background(), "DELETE FROM users WHERE email = $1", email) })
	suite.register(email)
	completeLedgerOnboarding(t, suite, "1000")
	account := getLedgerAccounts(t, suite)[0]
	categories := getLedgerCategories(t, suite)
	var incomeCategory, expenseCategory uuid.UUID
	for _, category := range categories {
		if category.Direction == api.CategoryDirectionINCOME {
			incomeCategory = category.Id
		} else {
			expenseCategory = category.Id
		}
	}
	createLedgerTransaction(t, suite, map[string]any{"type": "INCOME", "eventDate": "2026-08-05", "amount": "500", "idempotencyKey": uuid.New(), "accountId": account.Id, "categoryId": incomeCategory})
	createLedgerTransaction(t, suite, map[string]any{"type": "EXPENSE", "eventDate": "2026-08-06", "amount": "100", "idempotencyKey": uuid.New(), "accountId": account.Id, "categoryId": expenseCategory})
	response := suite.request(http.MethodGet, "/api/v1/dashboard?month=2026-08", nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("dashboard: expected 200, got %d", response.StatusCode)
	}
	dashboard := integrationBody[api.DashboardResponse](t, response)
	if dashboard.NetWorth != "1400" || dashboard.Cash != "1400" || dashboard.MonthlyIncome != "500" || dashboard.MonthlyExpenses != "100" || dashboard.NetSavings != "400" || dashboard.SavingsRate != "80" {
		t.Fatalf("unexpected dashboard: %#v", dashboard)
	}
	if dashboard.FxStatus.State != "COMPLETE" || len(dashboard.CashflowHistory) != 12 || len(dashboard.NetWorthHistory) != 12 {
		t.Fatalf("unexpected dashboard status/history: %#v", dashboard)
	}
}

func TestDashboardSurfacesMissingAndStaleFXRatesIntegration(t *testing.T) {
	suite := newIdentityIntegration(t)
	email := fmt.Sprintf("dashboard-fx-%d@integration.myfinance.local", time.Now().UnixNano())
	t.Cleanup(func() { _, _ = suite.pool.Exec(context.Background(), "DELETE FROM users WHERE email = $1", email) })
	suite.register(email)
	completeLedgerOnboarding(t, suite, "1000")
	expectStatus(t, suite.request(http.MethodPatch, "/api/v1/users/me/settings", map[string]string{
		"timezone": "UTC", "functionalCurrency": "USD", "displayCurrency": "KZT", "reconciliationMode": "CONFIRM",
	}), http.StatusOK)

	missingResponse := suite.request(http.MethodGet, "/api/v1/dashboard?month=2026-08", nil)
	if missingResponse.StatusCode != http.StatusOK {
		content, _ := io.ReadAll(missingResponse.Body)
		_ = missingResponse.Body.Close()
		t.Fatalf("missing dashboard: expected 200, got %d: %s", missingResponse.StatusCode, content)
	}
	missing := integrationBody[api.DashboardResponse](t, missingResponse)
	if missing.FxStatus.State != "INCOMPLETE" || len(missing.FxStatus.MissingCurrencies) != 1 || missing.FxStatus.MissingCurrencies[0] != "KZT" {
		t.Fatalf("expected KZT missing-rate status, got %#v", missing.FxStatus)
	}
	if _, err := suite.pool.Exec(context.Background(), `
		INSERT INTO fx_rates (provider, base_currency, quote_currency, rate, rate_date, stale_at)
		SELECT 'YAHOO', 'USD', 'KZT', 500, rate_date::date, now()
		FROM generate_series('2025-09-01'::date, '2026-08-01'::date, '1 month'::interval) rate_date
		ON CONFLICT (provider, base_currency, quote_currency, rate_date)
		DO UPDATE SET rate = EXCLUDED.rate, stale_at = EXCLUDED.stale_at`); err != nil {
		t.Fatalf("insert stale FX cache row: %v", err)
	}
	t.Cleanup(func() {
		_, _ = suite.pool.Exec(context.Background(), `DELETE FROM fx_rates WHERE provider = 'YAHOO' AND base_currency = 'USD' AND quote_currency = 'KZT' AND rate_date BETWEEN '2025-09-01' AND '2026-08-01'`)
	})
	staleResponse := suite.request(http.MethodGet, "/api/v1/dashboard?month=2026-08", nil)
	if staleResponse.StatusCode != http.StatusOK {
		content, _ := io.ReadAll(staleResponse.Body)
		_ = staleResponse.Body.Close()
		t.Fatalf("stale dashboard: expected 200, got %d: %s", staleResponse.StatusCode, content)
	}
	stale := integrationBody[api.DashboardResponse](t, staleResponse)
	if stale.FxStatus.State != "STALE" || len(stale.FxStatus.StaleCurrencies) != 1 || stale.FxStatus.StaleCurrencies[0] != "KZT" {
		t.Fatalf("expected KZT stale-rate status, got %#v", stale.FxStatus)
	}
}
