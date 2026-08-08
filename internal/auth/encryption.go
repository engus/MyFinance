package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
)

var ErrInvalidCiphertext = errors.New("invalid encrypted secret")

func EncryptSecret(key []byte, plaintext string) ([]byte, error) {
	aead, err := secretAEAD(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("generate secret nonce: %w", err)
	}
	return aead.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

func DecryptSecret(key []byte, ciphertext []byte) (string, error) {
	aead, err := secretAEAD(key)
	if err != nil {
		return "", err
	}
	if len(ciphertext) < aead.NonceSize()+aead.Overhead() {
		return "", ErrInvalidCiphertext
	}
	nonce := ciphertext[:aead.NonceSize()]
	plaintext, err := aead.Open(nil, nonce, ciphertext[aead.NonceSize():], nil)
	if err != nil {
		return "", ErrInvalidCiphertext
	}
	return string(plaintext), nil
}

func secretAEAD(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, errors.New("TOTP encryption key must contain 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create secret cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create secret AEAD: %w", err)
	}
	return aead, nil
}
