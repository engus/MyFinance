package auth

import (
	"bytes"
	"testing"
)

func TestSessionTokenIsRandomAndStoresOnlyDigest(t *testing.T) {
	first, firstDigest, err := NewSessionToken()
	if err != nil {
		t.Fatalf("create first token: %v", err)
	}
	second, secondDigest, err := NewSessionToken()
	if err != nil {
		t.Fatalf("create second token: %v", err)
	}

	if first == second || bytes.Equal(firstDigest, secondDigest) {
		t.Fatal("expected independent session tokens")
	}
	if len(firstDigest) != sha256DigestLength || bytes.Contains(firstDigest, []byte(first)) {
		t.Fatalf("expected an opaque SHA-256 digest, got %d bytes", len(firstDigest))
	}
}

const sha256DigestLength = 32
