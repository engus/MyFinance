package fx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/engus/myfinance/internal/money"
	"github.com/jackc/pgx/v5/pgxpool"
)

var SupportedCurrencies = []string{"USD", "EUR", "JPY", "GBP", "CNY", "AUD", "CAD", "CHF", "HKD", "SGD", "SEK", "KRW", "NOK", "NZD", "INR", "MXN", "TWD", "ZAR", "BRL", "DKK", "UAH", "KZT", "RUB", "AED"}

var ErrUnavailable = errors.New("FX quote is unavailable")

type Snapshot struct {
	Base, Quote string
	Rate        string
	Date        time.Time
}

type Provider interface {
	Fetch(context.Context, string, string) (Snapshot, error)
}

// HistoricalProvider is optional so a lightweight provider can still be used in
// tests or deployments that only need the current daily quote.
type HistoricalProvider interface {
	FetchHistory(context.Context, string, string, time.Time, time.Time) ([]Snapshot, error)
}

type RefreshResult struct {
	Locked, Fresh, Stale int
}

type YahooProvider struct {
	Client   *http.Client
	Endpoint string
}

func NewYahooProvider(client *http.Client) *YahooProvider {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &YahooProvider{Client: client, Endpoint: "https://query1.finance.yahoo.com/v8/finance/chart"}
}

func (provider *YahooProvider) Fetch(ctx context.Context, base, quote string) (Snapshot, error) {
	if base == quote {
		return Snapshot{Base: base, Quote: quote, Rate: "1", Date: time.Now().UTC()}, nil
	}
	symbol := url.PathEscape(strings.ToUpper(base) + strings.ToUpper(quote) + "=X")
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(provider.Endpoint, "/")+"/"+symbol+"?range=5d&interval=1d", nil)
	if err != nil {
		return Snapshot{}, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := provider.Client.Do(request)
	if err != nil {
		return Snapshot{}, fmt.Errorf("request Yahoo quote: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Snapshot{}, fmt.Errorf("%w: Yahoo responded with %s", ErrUnavailable, response.Status)
	}
	var body struct {
		Chart struct {
			Result []struct {
				Timestamp  []int64 `json:"timestamp"`
				Indicators struct {
					Quote []struct {
						Close []json.Number `json:"close"`
					} `json:"quote"`
				} `json:"indicators"`
			} `json:"result"`
		} `json:"chart"`
	}
	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&body); err != nil {
		return Snapshot{}, fmt.Errorf("decode Yahoo quote: %w", err)
	}
	if len(body.Chart.Result) == 0 || len(body.Chart.Result[0].Indicators.Quote) == 0 {
		return Snapshot{}, fmt.Errorf("%w: Yahoo returned no quote", ErrUnavailable)
	}
	result := body.Chart.Result[0]
	closes := result.Indicators.Quote[0].Close
	for index := min(len(result.Timestamp), len(closes)) - 1; index >= 0; index-- {
		if closes[index].String() == "" || closes[index].String() == "null" {
			continue
		}
		rate, err := normalize(closes[index].String())
		if err != nil || rate == "0" {
			continue
		}
		return Snapshot{Base: strings.ToUpper(base), Quote: strings.ToUpper(quote), Rate: rate, Date: time.Unix(result.Timestamp[index], 0).UTC()}, nil
	}
	return Snapshot{}, fmt.Errorf("%w: Yahoo returned no usable close", ErrUnavailable)
}

// FetchHistory returns every usable daily close in [start, end]. The Yahoo endpoint
// has no stability guarantee, so callers treat this as a cache-filling convenience,
// never as a prerequisite for posting a financial operation.
func (provider *YahooProvider) FetchHistory(ctx context.Context, base, quote string, start, end time.Time) ([]Snapshot, error) {
	if base == quote {
		return nil, nil
	}
	if end.Before(start) {
		return nil, errors.New("FX history end precedes start")
	}
	symbol := url.PathEscape(strings.ToUpper(base) + strings.ToUpper(quote) + "=X")
	query := url.Values{}
	query.Set("period1", fmt.Sprintf("%d", start.UTC().Unix()))
	query.Set("period2", fmt.Sprintf("%d", end.UTC().AddDate(0, 0, 1).Unix()))
	query.Set("interval", "1d")
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(provider.Endpoint, "/")+"/"+symbol+"?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := provider.Client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("request Yahoo FX history: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: Yahoo responded with %s", ErrUnavailable, response.Status)
	}
	var body struct {
		Chart struct {
			Result []struct {
				Timestamp  []int64 `json:"timestamp"`
				Indicators struct {
					Quote []struct {
						Close []json.Number `json:"close"`
					} `json:"quote"`
				} `json:"indicators"`
			} `json:"result"`
		} `json:"chart"`
	}
	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&body); err != nil {
		return nil, fmt.Errorf("decode Yahoo FX history: %w", err)
	}
	if len(body.Chart.Result) == 0 || len(body.Chart.Result[0].Indicators.Quote) == 0 {
		return nil, fmt.Errorf("%w: Yahoo returned no FX history", ErrUnavailable)
	}
	result := body.Chart.Result[0]
	closes := result.Indicators.Quote[0].Close
	snapshots := make([]Snapshot, 0, min(len(result.Timestamp), len(closes)))
	for index := 0; index < min(len(result.Timestamp), len(closes)); index++ {
		if closes[index].String() == "" || closes[index].String() == "null" {
			continue
		}
		rate, err := normalize(closes[index].String())
		if err != nil || rate == "0" {
			continue
		}
		date := time.Unix(result.Timestamp[index], 0).UTC()
		if date.Before(start.UTC()) || !date.Before(end.UTC().AddDate(0, 0, 1)) {
			continue
		}
		snapshots = append(snapshots, Snapshot{Base: strings.ToUpper(base), Quote: strings.ToUpper(quote), Rate: rate, Date: date})
	}
	if len(snapshots) == 0 {
		return nil, fmt.Errorf("%w: Yahoo returned no usable FX history", ErrUnavailable)
	}
	return snapshots, nil
}

func Refresh(ctx context.Context, pool *pgxpool.Pool, provider Provider, now time.Time) (RefreshResult, error) {
	var locked bool
	if err := pool.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtext('myfinance.fx.refresh'))`).Scan(&locked); err != nil {
		return RefreshResult{}, err
	}
	if !locked {
		return RefreshResult{}, nil
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtext('myfinance.fx.refresh'))`)
	}()
	result := RefreshResult{Locked: 1}
	for _, quote := range SupportedCurrencies {
		if quote == "USD" {
			continue
		}
		snapshot, err := fetchWithRetry(ctx, provider, "USD", quote)
		if err != nil {
			command, markErr := pool.Exec(ctx, `UPDATE fx_rates SET stale_at = COALESCE(stale_at, $3) WHERE provider = 'YAHOO' AND base_currency = $1 AND quote_currency = $2`, "USD", quote, now.UTC())
			if markErr != nil {
				return result, markErr
			}
			result.Stale += int(command.RowsAffected())
			continue
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO fx_rates (provider, base_currency, quote_currency, rate, rate_date, fetched_at, stale_at)
			VALUES ('YAHOO', $1, $2, $3::numeric, $4::date, $5, NULL)
			ON CONFLICT (provider, base_currency, quote_currency, rate_date)
			DO UPDATE SET rate = EXCLUDED.rate, fetched_at = EXCLUDED.fetched_at, stale_at = NULL`, snapshot.Base, snapshot.Quote, snapshot.Rate, dateOnly(snapshot.Date), now.UTC()); err != nil {
			return result, err
		}
		result.Fresh++
	}
	return result, nil
}

// BackfillHistory stores the daily snapshots needed to render the trailing
// twelve dashboard months. It only asks for currencies that are currently used
// by an account or selected as a display currency. Its advisory lock makes the
// job safe when more than one worker starts at once.
func BackfillHistory(ctx context.Context, pool *pgxpool.Pool, provider Provider, start, end time.Time) (RefreshResult, error) {
	historical, ok := provider.(HistoricalProvider)
	if !ok {
		return RefreshResult{}, nil
	}
	var locked bool
	if err := pool.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtext('myfinance.fx.backfill'))`).Scan(&locked); err != nil {
		return RefreshResult{}, err
	}
	if !locked {
		return RefreshResult{}, nil
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtext('myfinance.fx.backfill'))`)
	}()
	result := RefreshResult{Locked: 1}
	rows, err := pool.Query(ctx, `
		SELECT DISTINCT currency FROM (
			SELECT display_currency::text AS currency FROM users
			UNION
			SELECT currency::text AS currency FROM ledger_accounts WHERE role = 'USER'
		) currencies
		WHERE currency <> 'USD'`)
	if err != nil {
		return result, err
	}
	var currencies []string
	for rows.Next() {
		var currency string
		if err := rows.Scan(&currency); err != nil {
			return result, err
		}
		currencies = append(currencies, currency)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return result, err
	}
	rows.Close()
	for _, quote := range currencies {
		snapshots, err := fetchHistoryWithRetry(ctx, historical, "USD", quote, start, end)
		if err != nil {
			command, markErr := pool.Exec(ctx, `UPDATE fx_rates SET stale_at = COALESCE(stale_at, $3) WHERE provider = 'YAHOO' AND base_currency = $1 AND quote_currency = $2`, "USD", quote, end.UTC())
			if markErr != nil {
				return result, markErr
			}
			result.Stale += int(command.RowsAffected())
			continue
		}
		for _, snapshot := range snapshots {
			if _, err := pool.Exec(ctx, `
				INSERT INTO fx_rates (provider, base_currency, quote_currency, rate, rate_date, fetched_at, stale_at)
				VALUES ('YAHOO', $1, $2, $3::numeric, $4::date, now(), NULL)
				ON CONFLICT (provider, base_currency, quote_currency, rate_date)
				DO UPDATE SET rate = EXCLUDED.rate, fetched_at = EXCLUDED.fetched_at, stale_at = NULL`, snapshot.Base, snapshot.Quote, snapshot.Rate, dateOnly(snapshot.Date)); err != nil {
				return result, err
			}
			result.Fresh++
		}
	}
	return result, nil
}

func fetchWithRetry(ctx context.Context, provider Provider, base, quote string) (Snapshot, error) {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		snapshot, err := provider.Fetch(ctx, base, quote)
		if err == nil {
			return snapshot, nil
		}
		lastErr = err
		if attempt == 2 || errors.Is(err, ErrUnavailable) {
			break
		}
		if err := waitForRetry(ctx, attempt); err != nil {
			return Snapshot{}, err
		}
	}
	return Snapshot{}, lastErr
}

func fetchHistoryWithRetry(ctx context.Context, provider HistoricalProvider, base, quote string, start, end time.Time) ([]Snapshot, error) {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		snapshots, err := provider.FetchHistory(ctx, base, quote, start, end)
		if err == nil {
			return snapshots, nil
		}
		lastErr = err
		if attempt == 2 || errors.Is(err, ErrUnavailable) {
			break
		}
		if err := waitForRetry(ctx, attempt); err != nil {
			return nil, err
		}
	}
	return nil, lastErr
}

func waitForRetry(ctx context.Context, attempt int) error {
	delay := 150 * time.Millisecond * time.Duration(1<<attempt)
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func Convert(amount money.Amount, from, to string, lookup func(string, string) (string, error)) (money.Amount, error) {
	from, to = strings.ToUpper(from), strings.ToUpper(to)
	if from == to {
		return amount, nil
	}
	toUSD := func(currency string) (*big.Rat, error) {
		if currency == "USD" {
			return big.NewRat(1, 1), nil
		}
		rate, err := lookup("USD", currency)
		if err != nil {
			return nil, err
		}
		value, ok := new(big.Rat).SetString(rate)
		if !ok {
			return nil, ErrUnavailable
		}
		return value, nil
	}
	fromRate, err := toUSD(from)
	if err != nil {
		return money.Amount{}, err
	}
	toRate, err := toUSD(to)
	if err != nil {
		return money.Amount{}, err
	}
	value, ok := new(big.Rat).SetString(amount.String())
	if !ok {
		return money.Amount{}, money.ErrInvalidAmount
	}
	value.Quo(value, fromRate).Mul(value, toRate)
	return money.Parse(round(value))
}

func Percent(numerator, denominator money.Amount) (string, error) {
	if denominator.IsZero() {
		return "", errors.New("cannot divide by zero")
	}
	left, ok := new(big.Rat).SetString(numerator.String())
	if !ok {
		return "", money.ErrInvalidAmount
	}
	right, ok := new(big.Rat).SetString(denominator.String())
	if !ok {
		return "", money.ErrInvalidAmount
	}
	return round(left.Quo(left, right).Mul(left, big.NewRat(100, 1))), nil
}

func normalize(value string) (string, error) {
	rational, ok := new(big.Rat).SetString(value)
	if !ok || rational.Sign() <= 0 {
		return "", ErrUnavailable
	}
	return round(rational), nil
}

func round(value *big.Rat) string {
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(money.Scale), nil)
	scaled := new(big.Rat).Mul(value, new(big.Rat).SetInt(scale))
	numerator, denominator := scaled.Num(), scaled.Denom()
	quotient, remainder := new(big.Int).QuoRem(numerator, denominator, new(big.Int))
	twice := new(big.Int).Abs(remainder)
	twice.Mul(twice, big.NewInt(2))
	if twice.Cmp(new(big.Int).Abs(denominator)) >= 0 {
		if scaled.Sign() >= 0 {
			quotient.Add(quotient, big.NewInt(1))
		} else {
			quotient.Sub(quotient, big.NewInt(1))
		}
	}
	negative := quotient.Sign() < 0
	absolute := new(big.Int).Abs(quotient).String()
	if len(absolute) <= money.Scale {
		absolute = strings.Repeat("0", money.Scale+1-len(absolute)) + absolute
	}
	integer, fraction := absolute[:len(absolute)-money.Scale], strings.TrimRight(absolute[len(absolute)-money.Scale:], "0")
	result := integer
	if fraction != "" {
		result += "." + fraction
	}
	if negative {
		return "-" + result
	}
	return result
}

func dateOnly(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

func SortCurrencies(values []string) []string { sort.Strings(values); return values }
