package httpapi

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/engus/myfinance/internal/api"
	"github.com/google/uuid"
)

func TestRecurringGenerationAndReconciliationIntegration(t *testing.T) {
	suite := newIdentityIntegration(t)
	suffix := time.Now().UnixNano()
	email := fmt.Sprintf("recurring-reconciliation-%d@integration.myfinance.local", suffix)
	t.Cleanup(func() {
		_, _ = suite.pool.Exec(context.Background(), "DELETE FROM users WHERE email = $1", email)
	})

	suite.register(email)
	completeLedgerOnboarding(t, suite, "1000")
	accounts := getLedgerAccounts(t, suite)
	primaryID := accounts[0].Id
	categories := getLedgerCategories(t, suite)
	var incomeCategoryID, expenseCategoryID uuid.UUID
	for _, category := range categories {
		if category.Direction == api.CategoryDirectionINCOME {
			incomeCategoryID = category.Id
		} else if category.Direction == api.CategoryDirectionEXPENSE {
			expenseCategoryID = category.Id
		}
	}

	response := suite.request(http.MethodPost, "/api/v1/recurring-templates", map[string]any{
		"name": "Monthly consulting", "type": "INCOME", "amount": "100.00",
		"accountId": primaryID, "categoryId": incomeCategoryID,
		"frequency": "MONTHLY", "startDate": "2026-08-15",
	})
	if response.StatusCode != http.StatusCreated {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("create recurring template: expected 201, got %d: %s", response.StatusCode, content)
	}
	template := integrationBody[api.RecurringTemplate](t, response)

	start := make(chan struct{})
	results := make(chan RecurringGenerationResult, 2)
	errorsChannel := make(chan error, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			result, err := GenerateRecurring(context.Background(), suite.pool, time.Date(2026, 8, 15, 12, 0, 0, 0, time.UTC), 100)
			results <- result
			errorsChannel <- err
		}()
	}
	close(start)
	wait.Wait()
	close(results)
	close(errorsChannel)
	generated := 0
	for err := range errorsChannel {
		if err != nil {
			t.Fatalf("parallel recurring generation: %v", err)
		}
	}
	for result := range results {
		generated += result.Generated
	}
	if generated != 1 {
		t.Fatalf("parallel generation created %d occurrences, want 1", generated)
	}
	var occurrenceCount, transactionCount int
	if err := suite.pool.QueryRow(context.Background(), `SELECT count(*) FROM recurring_occurrences WHERE template_id = $1`, template.Id).Scan(&occurrenceCount); err != nil {
		t.Fatal(err)
	}
	if err := suite.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM ledger_transactions
		WHERE user_id = (SELECT id FROM users WHERE email = $1)
		  AND transaction_type = 'INCOME' AND event_date = DATE '2026-08-15'`, email).Scan(&transactionCount); err != nil {
		t.Fatal(err)
	}
	if occurrenceCount != 1 || transactionCount != 1 {
		t.Fatalf("occurrences=%d transactions=%d, want one each", occurrenceCount, transactionCount)
	}

	response = suite.request(http.MethodPatch, "/api/v1/categories/"+incomeCategoryID.String(), map[string]any{"archived": true})
	expectStatus(t, response, http.StatusOK)
	response = suite.request(http.MethodGet, "/api/v1/recurring-templates", nil)
	templates := integrationBody[api.RecurringTemplateListResponse](t, response).Templates
	if len(templates) != 1 || templates[0].Status != api.PAUSED || templates[0].PauseReason == nil || *templates[0].PauseReason != "DEPENDENCY_ARCHIVED" {
		t.Fatalf("archived category did not pause template: %#v", templates)
	}
	mayPreview := prepareReconciliation(t, suite, primaryID, "2026-05-31", "0", uuid.New())
	if mayPreview.Preview == nil {
		t.Fatalf("expected first historical reconciliation preview: %#v", mayPreview)
	}
	expectStatus(t, suite.request(http.MethodPost, "/api/v1/reconciliation/previews/"+mayPreview.Preview.Id.String()+"/confirm", nil), http.StatusCreated)

	periodEnd := "2026-08-31"
	response = suite.request(http.MethodGet, "/api/v1/reconciliation/status?periodEnd="+periodEnd, nil)
	status := integrationBody[api.ReconciliationStatus](t, response)
	if status.Complete || len(status.Accounts) != 1 || status.Accounts[0].Status != api.PENDING {
		t.Fatalf("unexpected pending reconciliation status: %#v", status)
	}

	firstPreview := prepareReconciliation(t, suite, primaryID, periodEnd, "900", uuid.New())
	if firstPreview.Preview == nil || firstPreview.Preview.Direction != api.OTHEREXPENSE || firstPreview.Preview.Difference != "-200" || !firstPreview.Preview.MultiMonthGap || firstPreview.Preview.GapMonths != 3 {
		t.Fatalf("unexpected first preview: %#v", firstPreview)
	}
	createLedgerTransaction(t, suite, map[string]any{
		"type": "EXPENSE", "eventDate": "2026-08-20", "amount": "10",
		"idempotencyKey": uuid.New(), "accountId": primaryID, "categoryId": expenseCategoryID,
		"description": "Late known expense",
	})
	expectStatus(t, suite.request(http.MethodPost, "/api/v1/reconciliation/previews/"+firstPreview.Preview.Id.String()+"/confirm", nil), http.StatusConflict)

	secondPreview := prepareReconciliation(t, suite, primaryID, periodEnd, "900", uuid.New())
	if secondPreview.Preview == nil || secondPreview.Preview.Difference != "-190" {
		t.Fatalf("preview was not refreshed after known expense: %#v", secondPreview)
	}
	response = suite.request(http.MethodPost, "/api/v1/reconciliation/previews/"+secondPreview.Preview.Id.String()+"/confirm", nil)
	if response.StatusCode != http.StatusCreated {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("confirm reconciliation: expected 201, got %d: %s", response.StatusCode, content)
	}
	firstReconciliation := integrationBody[api.Reconciliation](t, response)
	if firstReconciliation.AdjustmentAmount != "-190" || firstReconciliation.AdjustmentTransactionId == nil {
		t.Fatalf("unexpected reconciliation adjustment: %#v", firstReconciliation)
	}

	correctionPreview := prepareReconciliation(t, suite, primaryID, periodEnd, "950", uuid.New())
	if correctionPreview.Preview == nil || correctionPreview.Preview.Difference != "50" || correctionPreview.Preview.Direction != api.OTHERINCOME {
		t.Fatalf("unexpected correction preview: %#v", correctionPreview)
	}
	response = suite.request(http.MethodPost, "/api/v1/reconciliation/previews/"+correctionPreview.Preview.Id.String()+"/confirm", nil)
	if response.StatusCode != http.StatusCreated {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("confirm reconciliation correction: expected 201, got %d: %s", response.StatusCode, content)
	}
	corrected := integrationBody[api.Reconciliation](t, response)
	if corrected.AdjustmentAmount != "-140" || corrected.ReversalTransactionId == nil || corrected.SupersedesReconciliationId == nil {
		t.Fatalf("reconciliation correction did not preserve reversal history: %#v", corrected)
	}
	accounts = getLedgerAccounts(t, suite)
	if accounts[0].Balance != "950.00000000" {
		t.Fatalf("reconciled account balance = %s, want 950", accounts[0].Balance)
	}
	response = suite.request(http.MethodGet, "/api/v1/reconciliation/status?periodEnd="+periodEnd, nil)
	status = integrationBody[api.ReconciliationStatus](t, response)
	if !status.Complete || status.Accounts[0].Status != api.RECONCILED {
		t.Fatalf("month should be complete after account reconciliation: %#v", status)
	}

	var activeAugust int
	if err := suite.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM reconciliations
		WHERE account_id = $1 AND period_end = DATE '2026-08-31' AND superseded_at IS NULL`, primaryID).Scan(&activeAugust); err != nil {
		t.Fatal(err)
	}
	if activeAugust != 1 {
		t.Fatalf("active August reconciliations = %d, want 1", activeAugust)
	}
}

func TestAutoReconciliationIsAtomicAndIdempotentIntegration(t *testing.T) {
	suite := newIdentityIntegration(t)
	suffix := time.Now().UnixNano()
	email := fmt.Sprintf("auto-reconciliation-%d@integration.myfinance.local", suffix)
	t.Cleanup(func() {
		_, _ = suite.pool.Exec(context.Background(), "DELETE FROM users WHERE email = $1", email)
	})
	suite.register(email)
	response := suite.request(http.MethodPost, "/api/v1/onboarding/complete", map[string]any{
		"timezone": "UTC", "functionalCurrency": "USD", "displayCurrency": "USD", "reconciliationMode": "AUTO",
		"account": map[string]any{
			"name": "Auto bank", "accountClass": "ASSET", "subtype": "bank", "currency": "USD",
			"openingBalance": "500", "openingBalanceDate": "2026-08-01",
		},
	})
	expectStatus(t, response, http.StatusOK)
	account := getLedgerAccounts(t, suite)[0]
	key := uuid.New()
	start := make(chan struct{})
	statuses := make(chan int, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			response := suite.request(http.MethodPost, "/api/v1/reconciliation/prepare", map[string]any{
				"accountId": account.Id, "periodEnd": "2026-08-31", "reportedBalance": "475", "idempotencyKey": key,
			})
			statuses <- response.StatusCode
			_ = response.Body.Close()
		}()
	}
	close(start)
	wait.Wait()
	close(statuses)
	successes := 0
	for status := range statuses {
		if status == http.StatusOK {
			successes++
		} else if status != http.StatusConflict {
			t.Fatalf("parallel AUTO reconciliation returned status %d", status)
		}
	}
	if successes == 0 {
		t.Fatal("parallel AUTO reconciliation did not apply either request")
	}
	retry := prepareReconciliation(t, suite, account.Id, "2026-08-31", "475", key)
	if retry.Outcome != api.APPLIED || retry.Reconciliation == nil {
		t.Fatalf("AUTO retry did not return the applied reconciliation: %#v", retry)
	}
	var count int
	if err := suite.pool.QueryRow(context.Background(), `SELECT count(*) FROM reconciliations WHERE user_id = (SELECT id FROM users WHERE email = $1)`, email).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("AUTO retry created %d reconciliations, want 1", count)
	}
}

func prepareReconciliation(t *testing.T, suite *identityIntegration, accountID uuid.UUID, periodEnd, reported string, key uuid.UUID) api.ReconciliationSubmissionResponse {
	t.Helper()
	response := suite.request(http.MethodPost, "/api/v1/reconciliation/prepare", map[string]any{
		"accountId": accountID, "periodEnd": periodEnd, "reportedBalance": reported, "idempotencyKey": key,
	})
	if response.StatusCode != http.StatusOK {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("prepare reconciliation: expected 200, got %d: %s", response.StatusCode, content)
	}
	return integrationBody[api.ReconciliationSubmissionResponse](t, response)
}
