package money

import (
	"fmt"
	"testing"
)

func TestAmountRoundTrip(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		"0":                         "0",
		"12":                        "12",
		"12.34000000":               "12.34",
		"-0.00000001":               "-0.00000001",
		"9999999999999999.99999999": "9999999999999999.99999999",
	}
	for input, expected := range tests {
		amount, err := Parse(input)
		if err != nil {
			t.Fatalf("Parse(%q): %v", input, err)
		}
		if actual := amount.String(); actual != expected {
			t.Fatalf("Parse(%q).String() = %q, want %q", input, actual, expected)
		}
	}
}

func TestAmountRejectsInexactOrOutOfRangeInput(t *testing.T) {
	t.Parallel()
	for _, input := range []string{"", " 1", "+1", "01", "1.", ".1", "1.000000001", "1e2", "10000000000000000"} {
		if _, err := Parse(input); err == nil {
			t.Fatalf("Parse(%q) unexpectedly succeeded", input)
		}
	}
}

func TestBalancedProperty(t *testing.T) {
	t.Parallel()
	for integer := int64(1); integer < 10_000; integer += 37 {
		amount, err := Parse(new(bigInt).decimal(integer))
		if err != nil {
			t.Fatal(err)
		}
		if total := amount.Add(amount.Negate()); !total.IsZero() {
			t.Fatalf("%s and its negation did not balance", amount.String())
		}
	}
}

type bigInt struct{}

func (*bigInt) decimal(value int64) string {
	return fmt.Sprintf("%d.%08d", value, value%100_000_000)
}
