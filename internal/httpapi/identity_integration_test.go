package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/engus/myfinance/internal/api"
	"github.com/jackc/pgx/v5/pgxpool"
)

const integrationPassword = "IntegrationPass2026!"

type identityIntegration struct {
	t      *testing.T
	pool   *pgxpool.Pool
	server *httptest.Server
	client *http.Client
}

func newIdentityIntegration(t *testing.T) *identityIntegration {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set; integration database test skipped")
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("connect to test database: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Fatalf("ping test database: %v", err)
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		pool.Close()
		t.Fatalf("create cookie jar: %v", err)
	}
	handler := NewHandler(
		NewServer(pool, "integration", WithTOTPEncryptionKey([]byte("0123456789abcdef0123456789abcdef"))),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	server := httptest.NewServer(handler)
	t.Cleanup(func() {
		server.Close()
		pool.Close()
	})
	return &identityIntegration{
		t:      t,
		pool:   pool,
		server: server,
		client: &http.Client{Jar: jar},
	}
}

func (suite *identityIntegration) request(method string, path string, payload any) *http.Response {
	suite.t.Helper()
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			suite.t.Fatalf("encode %s request: %v", path, err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, suite.server.URL+path, body)
	if err != nil {
		suite.t.Fatalf("create %s request: %v", path, err)
	}
	request.Header.Set("Accept", "application/json")
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := suite.client.Do(request)
	if err != nil {
		suite.t.Fatalf("perform %s request: %v", path, err)
	}
	return response
}

func integrationBody[T any](t *testing.T, response *http.Response) T {
	t.Helper()
	defer response.Body.Close()
	var body T
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response with status %d: %v", response.StatusCode, err)
	}
	return body
}

func expectStatus(t *testing.T, response *http.Response, expected int) {
	t.Helper()
	if response.StatusCode == expected {
		_ = response.Body.Close()
		return
	}
	content, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	t.Fatalf("expected status %d, got %d: %s", expected, response.StatusCode, content)
}

func (suite *identityIntegration) register(email string) api.AuthResponse {
	suite.t.Helper()
	response := suite.request(http.MethodPost, "/api/v1/auth/register", map[string]string{
		"displayName": "Integration User",
		"email":       email,
		"password":    integrationPassword,
	})
	if response.StatusCode != http.StatusCreated {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		suite.t.Fatalf("register: expected 201, got %d: %s", response.StatusCode, content)
	}
	return integrationBody[api.AuthResponse](suite.t, response)
}

func (suite *identityIntegration) clearCookies() {
	suite.t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		suite.t.Fatalf("create replacement cookie jar: %v", err)
	}
	suite.client.Jar = jar
}

func TestIdentityOwnershipOnboardingAndDeletionIntegration(t *testing.T) {
	suite := newIdentityIntegration(t)
	suffix := time.Now().UnixNano()
	firstEmail := fmt.Sprintf("owner-%d@integration.myfinance.local", suffix)
	secondEmail := fmt.Sprintf("other-%d@integration.myfinance.local", suffix)
	t.Cleanup(func() {
		_, _ = suite.pool.Exec(context.Background(), "DELETE FROM users WHERE email = ANY($1)", []string{firstEmail, secondEmail})
	})

	first := suite.register(firstEmail)
	if first.User.OnboardingCompleted {
		t.Fatal("new user must require onboarding")
	}

	response := suite.request(http.MethodPost, "/api/v1/onboarding/complete", map[string]any{
		"timezone":           "Asia/Almaty",
		"functionalCurrency": "KZT",
		"displayCurrency":    "USD",
		"reconciliationMode": "CONFIRM",
		"account": map[string]any{
			"name":               "Primary bank",
			"accountClass":       "ASSET",
			"subtype":            "bank",
			"currency":           "KZT",
			"openingBalance":     "1250000.12500000",
			"openingBalanceDate": "2026-08-01",
		},
		"recurringIncome": map[string]any{
			"name":       "Salary",
			"amount":     "850000.50",
			"currency":   "KZT",
			"dayOfMonth": 25,
		},
	})
	if response.StatusCode != http.StatusOK {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("complete onboarding: expected 200, got %d: %s", response.StatusCode, content)
	}
	onboarding := integrationBody[api.CompleteOnboardingResponse](t, response)
	if !onboarding.User.OnboardingCompleted || onboarding.User.FunctionalCurrency != api.KZT {
		t.Fatalf("unexpected onboarding user: %#v", onboarding.User)
	}

	expectStatus(t, suite.request(http.MethodPost, "/api/v1/onboarding/complete", map[string]any{
		"timezone":           "UTC",
		"functionalCurrency": "USD",
		"displayCurrency":    "USD",
		"reconciliationMode": "CONFIRM",
		"account": map[string]any{
			"name": "Duplicate", "accountClass": "ASSET", "subtype": "cash", "currency": "USD",
			"openingBalance": "0", "openingBalanceDate": "2026-08-01",
		},
	}), http.StatusConflict)

	response = suite.request(http.MethodPatch, "/api/v1/users/me/settings", map[string]string{
		"timezone": "Europe/London", "functionalCurrency": "GBP", "displayCurrency": "EUR", "reconciliationMode": "AUTO",
	})
	if response.StatusCode != http.StatusConflict {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("change locked functional currency: expected 409, got %d: %s", response.StatusCode, content)
	}
	_ = response.Body.Close()
	response = suite.request(http.MethodPatch, "/api/v1/users/me/settings", map[string]string{
		"timezone": "Europe/London", "functionalCurrency": "KZT", "displayCurrency": "EUR", "reconciliationMode": "AUTO",
	})
	if response.StatusCode != http.StatusOK {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("update unlocked settings: expected 200, got %d: %s", response.StatusCode, content)
	}
	updated := integrationBody[api.AuthResponse](t, response)
	if updated.User.Timezone != "Europe/London" || updated.User.ReconciliationMode != api.AUTO {
		t.Fatalf("unexpected updated settings: %#v", updated.User)
	}

	firstCookies := append([]*http.Cookie(nil), suite.client.Jar.Cookies(mustURL(t, suite.server.URL))...)
	suite.clearCookies()
	suite.register(secondEmail)
	response = suite.request(http.MethodGet, "/api/v1/auth/sessions", nil)
	if response.StatusCode != http.StatusOK {
		expectStatus(t, response, http.StatusOK)
	}
	secondSessions := integrationBody[api.SessionListResponse](t, response)
	if len(secondSessions.Sessions) != 1 {
		t.Fatalf("expected one second-user session, got %d", len(secondSessions.Sessions))
	}

	suite.clearCookies()
	suite.client.Jar.SetCookies(mustURL(t, suite.server.URL), firstCookies)
	expectStatus(
		t,
		suite.request(http.MethodDelete, "/api/v1/auth/sessions/"+secondSessions.Sessions[0].Id.String(), nil),
		http.StatusNotFound,
	)
	expectStatus(t, suite.request(http.MethodDelete, "/api/v1/users/me", map[string]string{"password": "wrong-password"}), http.StatusUnauthorized)
	expectStatus(t, suite.request(http.MethodGet, "/api/v1/auth/me", nil), http.StatusOK)
	expectStatus(t, suite.request(http.MethodDelete, "/api/v1/users/me", map[string]string{"password": integrationPassword}), http.StatusNoContent)
	expectStatus(t, suite.request(http.MethodGet, "/api/v1/auth/me", nil), http.StatusUnauthorized)
}

func TestTOTPRecoveryLoginIntegration(t *testing.T) {
	suite := newIdentityIntegration(t)
	email := fmt.Sprintf("totp-%d@integration.myfinance.local", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = suite.pool.Exec(context.Background(), "DELETE FROM users WHERE email = $1", email)
	})
	suite.register(email)

	response := suite.request(http.MethodPost, "/api/v1/auth/totp/setup", nil)
	if response.StatusCode != http.StatusCreated {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("setup TOTP: expected 201, got %d: %s", response.StatusCode, content)
	}
	setup := integrationBody[api.TOTPSetupResponse](t, response)
	var ciphertext []byte
	if err := suite.pool.QueryRow(context.Background(), `
		SELECT secret_ciphertext
		FROM totp_credentials
		JOIN users ON users.id = totp_credentials.user_id
		WHERE users.email = $1
	`, email).Scan(&ciphertext); err != nil {
		t.Fatalf("read encrypted TOTP secret: %v", err)
	}
	if bytes.Contains(ciphertext, []byte(setup.Secret)) {
		t.Fatal("TOTP secret was stored as plaintext")
	}

	code := integrationTOTPCode(t, setup.Secret, time.Now())
	response = suite.request(http.MethodPost, "/api/v1/auth/totp/confirm", map[string]string{"code": code})
	if response.StatusCode != http.StatusOK {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("confirm TOTP: expected 200, got %d: %s", response.StatusCode, content)
	}
	confirmed := integrationBody[api.TOTPConfirmResponse](t, response)
	if len(confirmed.RecoveryCodes) != 10 {
		t.Fatalf("expected 10 recovery codes, got %d", len(confirmed.RecoveryCodes))
	}
	expectStatus(t, suite.request(http.MethodPost, "/api/v1/auth/logout", nil), http.StatusNoContent)

	challenge := suite.loginChallenge(email)
	response = suite.request(http.MethodPost, "/api/v1/auth/login/recovery", map[string]string{
		"challengeToken": challenge.ChallengeToken,
		"recoveryCode":   confirmed.RecoveryCodes[0],
	})
	if response.StatusCode != http.StatusOK {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("recovery login: expected 200, got %d: %s", response.StatusCode, content)
	}
	loggedIn := integrationBody[api.AuthResponse](t, response)
	if !loggedIn.User.TotpEnabled {
		t.Fatal("recovery login response must report TOTP enabled")
	}
	expectStatus(t, suite.request(http.MethodPost, "/api/v1/auth/logout", nil), http.StatusNoContent)

	challenge = suite.loginChallenge(email)
	expectStatus(t, suite.request(http.MethodPost, "/api/v1/auth/login/recovery", map[string]string{
		"challengeToken": challenge.ChallengeToken,
		"recoveryCode":   confirmed.RecoveryCodes[0],
	}), http.StatusUnauthorized)
}

func (suite *identityIntegration) loginChallenge(email string) api.LoginChallengeResponse {
	suite.t.Helper()
	response := suite.request(http.MethodPost, "/api/v1/auth/login", map[string]string{
		"email": email, "password": integrationPassword,
	})
	if response.StatusCode != http.StatusAccepted {
		content, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		suite.t.Fatalf("request login challenge: expected 202, got %d: %s", response.StatusCode, content)
	}
	return integrationBody[api.LoginChallengeResponse](suite.t, response)
}

func mustURL(t *testing.T, value string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}
	return parsed
}

func integrationTOTPCode(t *testing.T, secret string, now time.Time) string {
	t.Helper()
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if err != nil {
		t.Fatalf("decode TOTP secret: %v", err)
	}
	message := make([]byte, 8)
	binary.BigEndian.PutUint64(message, uint64(now.Unix()/30))
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(message)
	digest := mac.Sum(nil)
	offset := digest[len(digest)-1] & 0x0f
	value := binary.BigEndian.Uint32(digest[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", value%1_000_000)
}
