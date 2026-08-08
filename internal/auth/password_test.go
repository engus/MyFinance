package auth

import (
	"errors"
	"strings"
	"testing"
)

func TestPasswordHashRoundTrip(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$") {
		t.Fatalf("unexpected encoding: %q", hash)
	}

	valid, err := VerifyPassword(hash, "correct horse battery staple")
	if err != nil || !valid {
		t.Fatalf("expected password to verify, valid=%t err=%v", valid, err)
	}

	valid, err = VerifyPassword(hash, "wrong password")
	if err != nil || valid {
		t.Fatalf("expected wrong password to fail, valid=%t err=%v", valid, err)
	}
}

func TestPasswordHashRejectsInvalidEncoding(t *testing.T) {
	valid, err := VerifyPassword("not-a-password-hash", "password")
	if valid || !errors.Is(err, ErrInvalidPasswordHash) {
		t.Fatalf("expected invalid hash error, valid=%t err=%v", valid, err)
	}
}
