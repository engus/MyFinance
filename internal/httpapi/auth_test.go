package httpapi

import "testing"

func TestNormalizeEmail(t *testing.T) {
	normalized, valid := normalizeEmail("  DEMO@MYFINANCE.LOCAL ")
	if !valid || normalized != "demo@myfinance.local" {
		t.Fatalf("unexpected normalized email: %q valid=%t", normalized, valid)
	}

	if _, valid := normalizeEmail("not-an-email"); valid {
		t.Fatal("invalid email should be rejected")
	}
}
