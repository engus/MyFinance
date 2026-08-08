package httpapi

import (
	"testing"
	"time"
)

func TestNextRecurringDatePreservesMonthEndAnchor(t *testing.T) {
	t.Parallel()
	anchor := time.Date(2027, time.January, 31, 0, 0, 0, 0, time.UTC)
	february := nextRecurringDate(anchor, anchor, "MONTHS", 1)
	if want := "2027-02-28"; february.Format("2006-01-02") != want {
		t.Fatalf("first monthly occurrence = %s, want %s", february.Format("2006-01-02"), want)
	}
	march := nextRecurringDate(anchor, february, "MONTHS", 1)
	if want := "2027-03-31"; march.Format("2006-01-02") != want {
		t.Fatalf("month-end anchor drifted: got %s, want %s", march.Format("2006-01-02"), want)
	}
}

func TestNextRecurringDateHandlesLeapYearAndCustomIntervals(t *testing.T) {
	t.Parallel()
	leapAnchor := time.Date(2024, time.February, 29, 0, 0, 0, 0, time.UTC)
	first := nextRecurringDate(leapAnchor, leapAnchor, "YEARS", 1)
	second := nextRecurringDate(leapAnchor, first, "YEARS", 1)
	if first.Format("2006-01-02") != "2025-02-28" || second.Format("2006-01-02") != "2026-02-28" {
		t.Fatalf("unexpected yearly sequence: %s, %s", first, second)
	}
	custom := nextRecurringDate(leapAnchor, leapAnchor, "WEEKS", 3)
	if custom.Format("2006-01-02") != "2024-03-21" {
		t.Fatalf("three-week interval = %s", custom.Format("2006-01-02"))
	}
}

func TestReconciliationWindowAcrossYearBoundary(t *testing.T) {
	t.Parallel()
	tests := []struct {
		today, period string
		open          bool
	}{
		{"2026-12-25", "2026-11-30", false},
		{"2026-12-26", "2026-12-31", true},
		{"2027-01-05", "2026-12-31", true},
		{"2027-01-06", "2026-12-31", false},
	}
	for _, test := range tests {
		today, _ := time.Parse("2006-01-02", test.today)
		period, _, _, open := reconciliationWindow(today)
		if period.Format("2006-01-02") != test.period || open != test.open {
			t.Fatalf("window(%s) = (%s, %t), want (%s, %t)", test.today, period.Format("2006-01-02"), open, test.period, test.open)
		}
	}
}

func TestReconciliationGapMonths(t *testing.T) {
	t.Parallel()
	august, _ := time.Parse("2006-01-02", "2026-08-31")
	november, _ := time.Parse("2006-01-02", "2026-11-30")
	if got := reconciliationGapMonths(&august, november); got != 3 {
		t.Fatalf("gap months = %d, want 3", got)
	}
	if got := reconciliationGapMonths(nil, november); got != 1 {
		t.Fatalf("first reconciliation gap = %d, want 1", got)
	}
}
