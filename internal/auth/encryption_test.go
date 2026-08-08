package auth

import (
	"bytes"
	"errors"
	"testing"
)

func TestEncryptedSecretRoundTripAndTamperDetection(t *testing.T) {
	key := bytes.Repeat([]byte{0x42}, 32)
	ciphertext, err := EncryptSecret(key, "TOPSECRET")
	if err != nil {
		t.Fatalf("encrypt secret: %v", err)
	}
	plaintext, err := DecryptSecret(key, ciphertext)
	if err != nil || plaintext != "TOPSECRET" {
		t.Fatalf("decrypt secret: plaintext=%q err=%v", plaintext, err)
	}

	ciphertext[len(ciphertext)-1] ^= 0xff
	if _, err := DecryptSecret(key, ciphertext); !errors.Is(err, ErrInvalidCiphertext) {
		t.Fatalf("expected tamper error, got %v", err)
	}
}
