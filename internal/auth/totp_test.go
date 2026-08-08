package auth

import (
	"strings"
	"testing"
	"time"
)

func TestTOTPMatchesRFC6238SHA1Vector(t *testing.T) {
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	code, err := totpAt(secret, 59/30, 8)
	if err != nil {
		t.Fatalf("generate TOTP: %v", err)
	}
	if code != "94287082" {
		t.Fatalf("expected RFC vector 94287082, got %s", code)
	}
}

func TestValidateTOTPRejectsReplay(t *testing.T) {
	secret, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("generate secret: %v", err)
	}
	now := time.Unix(1_800_000_000, 0)
	step := now.Unix() / 30
	code, err := totpAt(secret, step, totpDigits)
	if err != nil {
		t.Fatalf("generate code: %v", err)
	}

	matchedStep, valid := ValidateTOTP(secret, code, now, -1)
	if !valid || matchedStep != step {
		t.Fatalf("expected valid code at step %d, got step=%d valid=%t", step, matchedStep, valid)
	}
	if _, valid := ValidateTOTP(secret, code, now, matchedStep); valid {
		t.Fatal("a successfully used time step must not validate again")
	}
}

func TestProvisioningURIContainsNoWhitespace(t *testing.T) {
	uri := TOTPProvisioningURI("ABCDEF234567ABCD", "demo@example.com")
	if !strings.HasPrefix(uri, "otpauth://totp/") || strings.Contains(uri, " ") {
		t.Fatalf("unexpected provisioning URI: %s", uri)
	}
}
