package httpapi

import (
	"sync"
	"time"
)

type loginLimitEntry struct {
	failures int
	resetAt  time.Time
}

type loginLimiter struct {
	mu      sync.Mutex
	entries map[string]loginLimitEntry
	maximum int
	window  time.Duration
}

func newLoginLimiter(maximum int, window time.Duration) *loginLimiter {
	return &loginLimiter{
		entries: make(map[string]loginLimitEntry),
		maximum: maximum,
		window:  window,
	}
}

func (limiter *loginLimiter) allowed(key string, now time.Time) bool {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()

	entry, exists := limiter.entries[key]
	if !exists || !now.Before(entry.resetAt) {
		delete(limiter.entries, key)
		return true
	}
	return entry.failures < limiter.maximum
}

func (limiter *loginLimiter) failed(key string, now time.Time) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()

	entry, exists := limiter.entries[key]
	if !exists || !now.Before(entry.resetAt) {
		entry = loginLimitEntry{resetAt: now.Add(limiter.window)}
	}
	entry.failures++
	limiter.entries[key] = entry

	if len(limiter.entries) > 1024 {
		for candidate, candidateEntry := range limiter.entries {
			if !now.Before(candidateEntry.resetAt) {
				delete(limiter.entries, candidate)
			}
		}
	}
}

func (limiter *loginLimiter) succeeded(key string) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	delete(limiter.entries, key)
}
