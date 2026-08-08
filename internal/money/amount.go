package money

import (
	"errors"
	"math/big"
	"strings"
)

const Scale = 8

var ErrInvalidAmount = errors.New("amount must be an exact decimal with at most 8 fractional digits")

type Amount struct {
	scaled big.Int
}

func Parse(value string) (Amount, error) {
	if value == "" || strings.TrimSpace(value) != value || strings.ContainsAny(value, "eE+") {
		return Amount{}, ErrInvalidAmount
	}

	negative := strings.HasPrefix(value, "-")
	unsigned := strings.TrimPrefix(value, "-")
	parts := strings.Split(unsigned, ".")
	if len(parts) > 2 || parts[0] == "" || len(parts[0]) > 16 || !digits(parts[0]) {
		return Amount{}, ErrInvalidAmount
	}
	if len(parts[0]) > 1 && parts[0][0] == '0' {
		return Amount{}, ErrInvalidAmount
	}

	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
		if fraction == "" || len(fraction) > Scale || !digits(fraction) {
			return Amount{}, ErrInvalidAmount
		}
	}

	digitsValue := parts[0] + fraction + strings.Repeat("0", Scale-len(fraction))
	scaled, ok := new(big.Int).SetString(digitsValue, 10)
	if !ok {
		return Amount{}, ErrInvalidAmount
	}
	if negative {
		scaled.Neg(scaled)
	}
	return Amount{scaled: *scaled}, nil
}

func (amount Amount) IsZero() bool {
	return amount.scaled.Sign() == 0
}

func (amount Amount) IsPositive() bool {
	return amount.scaled.Sign() > 0
}

func (amount Amount) Negate() Amount {
	var result big.Int
	result.Neg(&amount.scaled)
	return Amount{scaled: result}
}

func (amount Amount) Add(other Amount) Amount {
	var result big.Int
	result.Add(&amount.scaled, &other.scaled)
	return Amount{scaled: result}
}

func (amount Amount) String() string {
	if amount.scaled.Sign() == 0 {
		return "0"
	}
	abs := new(big.Int).Abs(new(big.Int).Set(&amount.scaled))
	digitsValue := abs.String()
	if len(digitsValue) <= Scale {
		digitsValue = strings.Repeat("0", Scale+1-len(digitsValue)) + digitsValue
	}
	integer := digitsValue[:len(digitsValue)-Scale]
	fraction := strings.TrimRight(digitsValue[len(digitsValue)-Scale:], "0")
	result := integer
	if fraction != "" {
		result += "." + fraction
	}
	if amount.scaled.Sign() < 0 {
		result = "-" + result
	}
	return result
}

func digits(value string) bool {
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}
