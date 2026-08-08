package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

const sessionTokenLength = 32

func NewSessionToken() (string, []byte, error) {
	raw := make([]byte, sessionTokenLength)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("generate session token: %w", err)
	}

	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, SessionTokenHash(token), nil
}

func SessionTokenHash(token string) []byte {
	digest := sha256.Sum256([]byte(token))
	return digest[:]
}
