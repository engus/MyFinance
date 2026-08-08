package auth

import (
	"bytes"
	"testing"
)

func TestRecoveryCodesAreUniqueAndNormalizationIsStable(t *testing.T) {
	codes, err := GenerateRecoveryCodes()
	if err != nil {
		t.Fatalf("generate recovery codes: %v", err)
	}
	if len(codes) != recoveryCodeCount {
		t.Fatalf("expected %d codes, got %d", recoveryCodeCount, len(codes))
	}
	seen := make(map[string]struct{}, len(codes))
	for _, code := range codes {
		if _, exists := seen[code]; exists {
			t.Fatalf("duplicate recovery code: %s", code)
		}
		seen[code] = struct{}{}
	}

	if !bytes.Equal(RecoveryCodeHash(codes[0]), RecoveryCodeHash("  "+codes[0]+"  ")) {
		t.Fatal("recovery-code normalization must be stable")
	}
}
