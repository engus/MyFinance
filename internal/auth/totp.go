package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" // SHA-1 is required for broad RFC 6238 authenticator interoperability.
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	totpSecretBytes = 20
	totpPeriod      = 30 * time.Second
	totpDigits      = 6
)

var ErrInvalidTOTPSecret = errors.New("invalid TOTP secret")

func GenerateTOTPSecret() (string, error) {
	raw := make([]byte, totpSecretBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate TOTP secret: %w", err)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw), nil
}

func TOTPProvisioningURI(secret string, accountName string) string {
	issuer := "MyFinance"
	label := url.PathEscape(issuer + ":" + accountName)
	values := url.Values{
		"algorithm": {"SHA1"},
		"digits":    {strconv.Itoa(totpDigits)},
		"issuer":    {issuer},
		"period":    {strconv.Itoa(int(totpPeriod.Seconds()))},
		"secret":    {secret},
	}
	return "otpauth://totp/" + label + "?" + values.Encode()
}

func ValidateTOTP(secret string, code string, now time.Time, lastUsedStep int64) (int64, bool) {
	normalizedCode := strings.TrimSpace(code)
	if len(normalizedCode) != totpDigits {
		return 0, false
	}

	currentStep := now.Unix() / int64(totpPeriod.Seconds())
	for _, offset := range []int64{-1, 0, 1} {
		candidateStep := currentStep + offset
		if candidateStep <= lastUsedStep {
			continue
		}
		expected, err := totpAt(secret, candidateStep, totpDigits)
		if err != nil {
			return 0, false
		}
		if subtle.ConstantTimeCompare([]byte(expected), []byte(normalizedCode)) == 1 {
			return candidateStep, true
		}
	}
	return 0, false
}

func totpAt(secret string, step int64, digits int) (string, error) {
	normalizedSecret := strings.ToUpper(strings.TrimSpace(secret))
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(normalizedSecret)
	if err != nil || len(key) < 16 {
		return "", ErrInvalidTOTPSecret
	}

	message := make([]byte, 8)
	binary.BigEndian.PutUint64(message, uint64(step))
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(message)
	digest := mac.Sum(nil)
	offset := digest[len(digest)-1] & 0x0f
	binaryCode := binary.BigEndian.Uint32(digest[offset:offset+4]) & 0x7fffffff

	modulus := uint32(1)
	for range digits {
		modulus *= 10
	}
	return fmt.Sprintf("%0*d", digits, binaryCode%modulus), nil
}
