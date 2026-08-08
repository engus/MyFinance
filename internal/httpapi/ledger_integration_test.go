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

func TestLedgerTypedOperationsOwnershipAndImmutabilityIntegration(t *testing.T) {
	suite := newIdentityIntegration(t)
	suffix := time.Now().UnixNano()
	ownerEmail := fmt.Sprintf("ledger-owner-%d@integration.myfinance.local", suffix)
	otherEmail := fmt.Sprintf("ledger-other-%d@integration.myfinance.local", suffix)
	t.Cleanup(func() {
		_, _ = suite.pool.Exec(context.Background(), "DELETE FROM users WHERE email = ANY($1)", []string{ownerEmail, otherEmail})
	})

	suite.register(ownerEmail)
	completeLedgerOnboarding(t, suite, "1000.00")

	accounts := getLedgerAccounts(t, suite)
	if len(accounts) != 1 || accounts[0].Balance != "1000.00000000" || !accounts[0].HasPostings {
		t.Fatalf("unexpected materialized opening account: %#v", accounts)
	}
	primaryID := accounts[0].Id
	categories := getLedgerCategories(t, suite)
	var incomeCategoryID, expenseCategoryID uuid.UUID
	for _, category := range categories {
		switch category.Direction {
		case api.CategoryDirection("INCOME"):
			incomeCategoryID = category.Id
		case api.CategoryDirection("EXPENSE"):
			expenseCategoryID = category.Id
		}
	}
	if incomeCategoryID == uuid.Nil || expenseCategoryID == uuid.Nil {
		t.Fatalf("default categories were not created: %#v", categories)
	}

	expenseKey := uuid.New()
	expense := createLedgerTransaction(t, suite, map[string]any{
		"type": "EXPENSE", "eventDate": "2026-08-08", "amount": "125.50",
		"idempotencyKey": expenseKey, "accountId": primaryID, "categoryId": expenseCategoryID,
		"description": "Groceries",
	})
	duplicate := createLedgerTransaction(t, suite, map[string]any{
		"type": "EXPENSE", "eventDate": "2026-08-08", "amount": "125.50",
		"idempotencyKey": expenseKey, "accountId": primaryID, "categoryId": expenseCategoryID,
		"description": "Groceries",
	})
	if duplicate.Id != expense.Id {
		t.Fatalf("idempotent retry created a second transaction: %s != %s", duplicate.Id, expense.Id)
	}

	income := createLedgerTransaction(t, suite, map[string]any{
		"type": "INCOME", "eventDate": "2026-08-09", "amount": "400",
		"idempotencyKey": uuid.New(), "accountId": primaryID, "categoryId": incomeCategoryID,
		"description": "Consulting",
	})
	if income.Amount != "400" || income.PrimaryAccountName != "Primary bank" {
		t.Fatalf("unexpected income response: %#v", income)
	}

	response := suite.request(http.MethodPost, "/api/v1/accounts", map[string]any{
		"name": "Savings", "accountClass": "ASSET", "subtype": "bank", "currency": "USD",
	})
	if response.StatusCode != http.StatusCreated {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("create second account: expected 201, got %d: %s", response.StatusCode, content)
	}
	savings := integrationBody[api.Account](t, response)
	createLedgerTransaction(t, suite, map[string]any{
		"type": "TRANSFER", "eventDate": "2026-08-09", "amount": "200",
		"idempotencyKey": uuid.New(), "sourceAccountId": primaryID, "destinationAccountId": savings.Id,
	})

	accounts = getLedgerAccounts(t, suite)
	balances := map[string]string{}
	for _, account := range accounts {
		balances[account.Name] = account.Balance
	}
	if balances["Primary bank"] != "1074.50000000" || balances["Savings"] != "200.00000000" {
		t.Fatalf("unexpected balances after typed operations: %#v", balances)
	}

	response = suite.request(http.MethodPost, "/api/v1/transactions/"+expense.Id.String()+"/reversal", map[string]any{
		"idempotencyKey": uuid.New(), "description": "Remove duplicate expense",
	})
	if response.StatusCode != http.StatusCreated {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("reverse expense: expected 201, got %d: %s", response.StatusCode, content)
	}
	reversal := integrationBody[api.Transaction](t, response)
	if reversal.Type != api.TransactionTypeREVERSAL || reversal.ReversesTransactionId == nil || *reversal.ReversesTransactionId != expense.Id {
		t.Fatalf("unexpected reversal: %#v", reversal)
	}
	expectStatus(t, suite.request(http.MethodPost, "/api/v1/transactions/"+expense.Id.String()+"/reversal", map[string]any{
		"idempotencyKey": uuid.New(),
	}), http.StatusConflict)

	response = suite.request(http.MethodPost, "/api/v1/transactions/"+income.Id.String()+"/replacement", map[string]any{
		"reversalIdempotencyKey": uuid.New(),
		"operation": map[string]any{
			"type": "INCOME", "eventDate": "2026-08-09", "amount": "450",
			"idempotencyKey": uuid.New(), "accountId": primaryID, "categoryId": incomeCategoryID,
			"description": "Corrected consulting",
		},
	})
	if response.StatusCode != http.StatusCreated {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("replace income: expected 201, got %d: %s", response.StatusCode, content)
	}
	replacement := integrationBody[api.ReplacementResponse](t, response)
	if replacement.Replacement.Amount != "450" || replacement.Reversal.ReversesTransactionId == nil {
		t.Fatalf("unexpected replacement response: %#v", replacement)
	}

	expectStatus(t, suite.request(http.MethodPatch, "/api/v1/accounts/"+primaryID.String(), map[string]any{
		"currency": "EUR",
	}), http.StatusConflict)

	response = suite.request(http.MethodGet, "/api/v1/transactions?limit=2", nil)
	if response.StatusCode != http.StatusOK {
		expectStatus(t, response, http.StatusOK)
	}
	page := integrationBody[api.TransactionListResponse](t, response)
	if len(page.Transactions) != 2 || page.NextCursor == nil {
		t.Fatalf("cursor page was not bounded: %#v", page)
	}
	response = suite.request(http.MethodGet, "/api/v1/transactions?limit=2&cursor="+*page.NextCursor, nil)
	if response.StatusCode != http.StatusOK {
		expectStatus(t, response, http.StatusOK)
	}
	nextPage := integrationBody[api.TransactionListResponse](t, response)
	if len(nextPage.Transactions) == 0 {
		t.Fatal("next cursor page must contain older operations")
	}

	if _, err := suite.pool.Exec(context.Background(), "UPDATE ledger_entries SET original_amount = 1 WHERE transaction_id = $1", income.Id); err == nil {
		t.Fatal("database allowed a posted ledger entry to be mutated")
	}

	ownerCookies := append([]*http.Cookie(nil), suite.client.Jar.Cookies(mustURL(t, suite.server.URL))...)
	suite.clearCookies()
	suite.register(otherEmail)
	expectStatus(t, suite.request(http.MethodPatch, "/api/v1/accounts/"+primaryID.String(), map[string]any{"name": "Stolen"}), http.StatusNotFound)
	suite.clearCookies()
	suite.client.Jar.SetCookies(mustURL(t, suite.server.URL), ownerCookies)
	expectStatus(t, suite.request(http.MethodPatch, "/api/v1/users/me/settings", map[string]string{
		"timezone": "UTC", "functionalCurrency": "EUR", "displayCurrency": "EUR", "reconciliationMode": "CONFIRM",
	}), http.StatusConflict)
}

func completeLedgerOnboarding(t *testing.T, suite *identityIntegration, openingBalance string) {
	t.Helper()
	response := suite.request(http.MethodPost, "/api/v1/onboarding/complete", map[string]any{
		"timezone": "UTC", "functionalCurrency": "USD", "displayCurrency": "USD", "reconciliationMode": "CONFIRM",
		"account": map[string]any{
			"name": "Primary bank", "accountClass": "ASSET", "subtype": "bank", "currency": "USD",
			"openingBalance": openingBalance, "openingBalanceDate": "2026-08-01",
		},
	})
	expectStatus(t, response, http.StatusOK)
}

func getLedgerAccounts(t *testing.T, suite *identityIntegration) []api.Account {
	t.Helper()
	response := suite.request(http.MethodGet, "/api/v1/accounts", nil)
	if response.StatusCode != http.StatusOK {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("list accounts: expected 200, got %d: %s", response.StatusCode, content)
	}
	return integrationBody[api.AccountListResponse](t, response).Accounts
}

func getLedgerCategories(t *testing.T, suite *identityIntegration) []api.Category {
	t.Helper()
	response := suite.request(http.MethodGet, "/api/v1/categories", nil)
	if response.StatusCode != http.StatusOK {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("list categories: expected 200, got %d: %s", response.StatusCode, content)
	}
	return integrationBody[api.CategoryListResponse](t, response).Categories
}

func createLedgerTransaction(t *testing.T, suite *identityIntegration, payload map[string]any) api.Transaction {
	t.Helper()
	response := suite.request(http.MethodPost, "/api/v1/transactions", payload)
	if response.StatusCode != http.StatusCreated {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("create transaction: expected 201, got %d: %s", response.StatusCode, content)
	}
	return integrationBody[api.Transaction](t, response)
}
