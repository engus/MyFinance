package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"fmt"
	"strings"
)

const (
	recoveryCodeCount = 10
	recoveryCodeBytes = 10
)

func GenerateRecoveryCodes() ([]string, error) {
	codes := make([]string, 0, recoveryCodeCount)
	for range recoveryCodeCount {
		raw := make([]byte, recoveryCodeBytes)
		if _, err := rand.Read(raw); err != nil {
			return nil, fmt.Errorf("generate recovery code: %w", err)
		}
		encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)
		codes = append(codes, strings.Join([]string{
			encoded[0:4], encoded[4:8], encoded[8:12], encoded[12:16],
		}, "-"))
	}
	return codes, nil
}

func RecoveryCodeHash(code string) []byte {
	normalized := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
	digest := sha256.Sum256([]byte(normalized))
	return digest[:]
}
