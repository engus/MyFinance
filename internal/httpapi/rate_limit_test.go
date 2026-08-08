package httpapi

import (
	"testing"
	"time"
)

func TestLoginLimiterBlocksFailuresUntilWindowExpires(t *testing.T) {
	limiter := newLoginLimiter(2, time.Minute)
	now := time.Date(2026, time.August, 9, 0, 0, 0, 0, time.UTC)

	if !limiter.allowed("client", now) {
		t.Fatal("new client should be allowed")
	}
	limiter.failed("client", now)
	limiter.failed("client", now)
	if limiter.allowed("client", now) {
		t.Fatal("client should be blocked at the failure limit")
	}
	if !limiter.allowed("client", now.Add(time.Minute)) {
		t.Fatal("client should be allowed after the window")
	}
}

func TestLoginLimiterClearsSuccessfulClient(t *testing.T) {
	limiter := newLoginLimiter(1, time.Minute)
	now := time.Now()
	limiter.failed("client", now)
	limiter.succeeded("client")
	if !limiter.allowed("client", now) {
		t.Fatal("successful login should reset failures")
	}
}
