package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/engus/myfinance/internal/api"
	"github.com/google/uuid"
)

func TestManualAssetsAndValuationsIntegration(t *testing.T) {
	suite := newIdentityIntegration(t)
	email := fmt.Sprintf("assets-%d@integration.myfinance.local", time.Now().UnixNano())
	t.Cleanup(func() { _, _ = suite.pool.Exec(context.Background(), "DELETE FROM users WHERE email = $1", email) })
	suite.register(email)
	completeLedgerOnboarding(t, suite, "1000")
	primary := getLedgerAccounts(t, suite)[0]

	createResponse := suite.request(http.MethodPost, "/api/v1/assets", map[string]any{
		"name": "Lake house", "type": "REAL_ESTATE", "currency": "USD", "ownershipShare": "50",
		"country": "Kazakhstan", "institution": "Family office", "idempotencyKey": uuid.New(),
		"purchase": map[string]any{"sourceAccountId": primary.Id, "amount": "400", "eventDate": "2026-08-10"},
	})
	if createResponse.StatusCode != http.StatusCreated {
		t.Fatalf("create asset: expected 201, got %d", createResponse.StatusCode)
	}
	asset := integrationBody[api.Asset](t, createResponse)
	if asset.CurrentOwnedValue != "400" || asset.PurchaseTransactionId == nil || asset.LedgerBalance != "400" {
		t.Fatalf("unexpected purchased asset: %#v", asset)
	}

	first := createAssetValuationForTest(t, suite, asset.Id, "2026-08-11", "1000")
	if first.OwnedValue != "500" || first.AdjustmentAmount != "100" || first.RevaluationTransactionId == nil {
		t.Fatalf("unexpected first valuation: %#v", first)
	}
	second := createAssetValuationForTest(t, suite, asset.Id, "2026-08-12", "700")
	if second.OwnedValue != "350" || second.LedgerBalanceBefore != "500" || second.AdjustmentAmount != "-150" {
		t.Fatalf("unexpected second valuation: %#v", second)
	}
	expectStatus(t, suite.request(http.MethodPost, "/api/v1/assets/"+asset.Id.String()+"/valuations", map[string]any{
		"valuationDate": "2026-08-01", "marketValue": "900", "idempotencyKey": uuid.New(),
	}), http.StatusConflict)

	response := suite.request(http.MethodGet, "/api/v1/assets", nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list assets: expected 200, got %d", response.StatusCode)
	}
	list := integrationBody[api.AssetListResponse](t, response)
	if len(list.Assets) != 1 || list.TotalCurrentOwnedValue != "350" || len(list.Allocations) != 1 || list.Allocations[0].CurrentOwnedValue != "350" {
		t.Fatalf("unexpected asset list: %#v", list)
	}
	response = suite.request(http.MethodGet, "/api/v1/assets/"+asset.Id.String()+"/valuations", nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list valuations: expected 200, got %d", response.StatusCode)
	}
	if values := integrationBody[api.AssetValuationListResponse](t, response).Valuations; len(values) != 2 {
		t.Fatalf("valuation history count = %d, want 2", len(values))
	}

	expectStatus(t, suite.request(http.MethodPatch, "/api/v1/assets/"+asset.Id.String(), map[string]any{"archived": true}), http.StatusOK)
	accounts := getLedgerAccountsWithArchive(t, suite)
	for _, account := range accounts {
		if account.Id == asset.LedgerAccountId && !account.Archived {
			t.Fatal("archiving an asset must archive its linked account")
		}
	}
}

func createAssetValuationForTest(t *testing.T, suite *identityIntegration, assetID uuid.UUID, date, value string) api.AssetValuation {
	t.Helper()
	response := suite.request(http.MethodPost, "/api/v1/assets/"+assetID.String()+"/valuations", map[string]any{
		"valuationDate": date, "marketValue": value, "idempotencyKey": uuid.New(),
	})
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("create valuation: expected 201, got %d", response.StatusCode)
	}
	return integrationBody[api.AssetValuation](t, response)
}

func getLedgerAccountsWithArchive(t *testing.T, suite *identityIntegration) []api.Account {
	t.Helper()
	response := suite.request(http.MethodGet, "/api/v1/accounts?includeArchived=true", nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list archived accounts: expected 200, got %d", response.StatusCode)
	}
	return integrationBody[api.AccountListResponse](t, response).Accounts
}
