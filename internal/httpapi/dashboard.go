package httpapi

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/engus/myfinance/internal/api"
	"github.com/engus/myfinance/internal/fx"
	"github.com/engus/myfinance/internal/money"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type dashboardRates struct {
	ctx     context.Context
	pool    pgx.Tx
	missing map[string]bool
	stale   map[string]bool
	cache   map[string]string
	date    time.Time
}

func (server *Server) GetDashboard(writer http.ResponseWriter, request *http.Request, params api.GetDashboardParams) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	if err := server.ensureLedger(request.Context(), authenticated.userID); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	month := time.Now().UTC()
	if params.Month != nil {
		parsed, err := time.Parse("2006-01", *params.Month)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "invalid_month", "Use YYYY-MM for the dashboard month.")
			return
		}
		month = parsed
	}
	response, err := server.dashboard(request.Context(), authenticated.userID, month)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, response)
}

func (server *Server) dashboard(ctx context.Context, userID pgtype.UUID, month time.Time) (api.DashboardResponse, error) {
	var functional, display string
	if err := server.pool.QueryRow(ctx, `SELECT functional_currency::text, display_currency::text FROM users WHERE id = $1`, userID).Scan(&functional, &display); err != nil {
		return api.DashboardResponse{}, err
	}
	tx, err := server.pool.Begin(ctx)
	if err != nil {
		return api.DashboardResponse{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rates := &dashboardRates{ctx: ctx, pool: tx, missing: map[string]bool{}, stale: map[string]bool{}, cache: map[string]string{}, date: time.Now().UTC()}
	zero := dashboardZero()
	netWorth, assets, liabilities, cash := zero, zero, zero, zero
	exposure := map[string]money.Amount{}
	rows, err := tx.Query(ctx, `
		SELECT account.account_class, account.subtype, account.currency::text, COALESCE(sum(entry.original_amount), 0)::text
		FROM ledger_accounts account
		LEFT JOIN ledger_entries entry ON entry.account_id = account.id AND entry.user_id = account.user_id
		WHERE account.user_id = $1 AND account.role = 'USER'
		GROUP BY account.id`, userID)
	if err != nil {
		return api.DashboardResponse{}, err
	}
	type accountBalance struct{ class, subtype, currency, raw string }
	balances := []accountBalance{}
	for rows.Next() {
		var balance accountBalance
		if err := rows.Scan(&balance.class, &balance.subtype, &balance.currency, &balance.raw); err != nil {
			rows.Close()
			return api.DashboardResponse{}, err
		}
		balances = append(balances, balance)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return api.DashboardResponse{}, err
	}
	rows.Close()
	for _, balance := range balances {
		amount, err := money.Parse(balance.raw)
		if err != nil {
			return api.DashboardResponse{}, err
		}
		converted, available, err := rates.convert(amount, balance.currency, display, time.Now().UTC())
		if err != nil {
			return api.DashboardResponse{}, err
		}
		if !available {
			continue
		}
		netWorth = netWorth.Add(converted)
		if balance.class == "ASSET" {
			assets = assets.Add(converted)
			if balance.subtype == "bank" || balance.subtype == "cash" || balance.subtype == "brokerage" {
				cash = cash.Add(converted)
			}
			exposure[balance.currency] = exposure[balance.currency].Add(converted)
		} else if balance.class == "LIABILITY" && !converted.IsPositive() {
			liabilities = liabilities.Add(converted.Negate())
		}
	}

	start := time.Date(month.Year(), month.Month(), 1, 0, 0, 0, 0, time.UTC)
	income, expenses, history, err := dashboardCashflow(ctx, tx, rates, userID, functional, display, start)
	if err != nil {
		return api.DashboardResponse{}, err
	}
	netSavings := income.Add(expenses.Negate())
	allocation, err := dashboardAllocation(ctx, tx, rates, userID, display)
	if err != nil {
		return api.DashboardResponse{}, err
	}
	netWorthHistory, err := dashboardNetWorthHistory(ctx, tx, rates, userID, display, start)
	if err != nil {
		return api.DashboardResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return api.DashboardResponse{}, err
	}
	missing, stale := dashboardCurrencies(rates.missing), dashboardCurrencies(rates.stale)
	state := api.DashboardFXStatusState("COMPLETE")
	if len(missing) > 0 {
		state = api.DashboardFXStatusState("INCOMPLETE")
	} else if len(stale) > 0 {
		state = api.DashboardFXStatusState("STALE")
	}
	savingsRate := ""
	if !income.IsZero() {
		value, err := dashboardPercent(netSavings, income)
		if err != nil {
			return api.DashboardResponse{}, err
		}
		savingsRate = value
	}
	return api.DashboardResponse{Currency: api.Currency(display), Month: start.Format("2006-01"), FxStatus: api.DashboardFXStatus{State: state, MissingCurrencies: missing, StaleCurrencies: stale}, NetWorth: netWorth.String(), Assets: assets.String(), Liabilities: liabilities.String(), Cash: cash.String(), MonthlyIncome: income.String(), MonthlyExpenses: expenses.String(), NetSavings: netSavings.String(), SavingsRate: savingsRate, CashflowHistory: history, NetWorthHistory: netWorthHistory, AssetAllocation: allocation, CurrencyExposure: dashboardBreakdowns(exposure)}, nil
}

func dashboardCashflow(ctx context.Context, tx pgx.Tx, rates *dashboardRates, userID pgtype.UUID, functional, display string, selected time.Time) (money.Amount, money.Amount, []api.DashboardCashflowPoint, error) {
	start := selected.AddDate(0, -11, 0)
	values := map[string]struct{ income, expense money.Amount }{}
	rows, err := tx.Query(ctx, `
		SELECT transaction.transaction_type, transaction.event_date, entry.functional_amount::text
		FROM ledger_transactions transaction
		JOIN ledger_entries entry ON entry.transaction_id = transaction.id AND entry.user_id = transaction.user_id
		JOIN ledger_accounts account ON account.id = entry.account_id
		WHERE transaction.user_id = $1 AND transaction.posted_at IS NOT NULL
		  AND transaction.event_date >= $2 AND transaction.event_date < $3
		  AND account.role = 'USER' AND account.account_class = 'ASSET'
		  AND transaction.transaction_type IN ('INCOME', 'EXPENSE', 'ASSET_PURCHASE', 'RECONCILIATION')`, userID, start, selected.AddDate(0, 1, 0))
	if err != nil {
		return money.Amount{}, money.Amount{}, nil, err
	}
	type cashflowEntry struct {
		kind, value string
		date        time.Time
	}
	entries := []cashflowEntry{}
	for rows.Next() {
		var entry cashflowEntry
		if err := rows.Scan(&entry.kind, &entry.date, &entry.value); err != nil {
			rows.Close()
			return money.Amount{}, money.Amount{}, nil, err
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return money.Amount{}, money.Amount{}, nil, err
	}
	rows.Close()
	for _, entry := range entries {
		amount, err := money.Parse(entry.value)
		if err != nil {
			return money.Amount{}, money.Amount{}, nil, err
		}
		if (entry.kind == "INCOME" && amount.IsPositive()) || (entry.kind == "RECONCILIATION" && amount.IsPositive()) {
			converted, available, err := rates.convert(amount, functional, display, entry.date)
			if err != nil {
				return money.Amount{}, money.Amount{}, nil, err
			}
			if available {
				current := values[entry.date.Format("2006-01")]
				current.income = current.income.Add(converted)
				values[entry.date.Format("2006-01")] = current
			}
		}
		if ((entry.kind == "EXPENSE" || entry.kind == "ASSET_PURCHASE") && !amount.IsPositive() && !amount.IsZero()) || (entry.kind == "RECONCILIATION" && !amount.IsPositive() && !amount.IsZero()) {
			converted, available, err := rates.convert(amount.Negate(), functional, display, entry.date)
			if err != nil {
				return money.Amount{}, money.Amount{}, nil, err
			}
			if available {
				current := values[entry.date.Format("2006-01")]
				current.expense = current.expense.Add(converted)
				values[entry.date.Format("2006-01")] = current
			}
		}
	}
	history := make([]api.DashboardCashflowPoint, 0, 12)
	zero := dashboardZero()
	selectedIncome, selectedExpense := zero, zero
	for offset := 0; offset < 12; offset++ {
		date := start.AddDate(0, offset, 0)
		item := values[date.Format("2006-01")]
		savings := item.income.Add(item.expense.Negate())
		history = append(history, api.DashboardCashflowPoint{Month: date.Format("2006-01"), Income: item.income.String(), Expenses: item.expense.String(), Savings: savings.String()})
		if offset == 11 {
			selectedIncome, selectedExpense = item.income, item.expense
		}
	}
	return selectedIncome, selectedExpense, history, nil
}

func dashboardAllocation(ctx context.Context, tx pgx.Tx, rates *dashboardRates, userID pgtype.UUID, display string) ([]api.DashboardBreakdown, error) {
	rows, err := tx.Query(ctx, `
		SELECT asset.asset_type, asset.currency::text, COALESCE(valuation.owned_value, balance.value)::text
		FROM assets asset JOIN ledger_accounts account ON account.id = asset.ledger_account_id
		CROSS JOIN LATERAL (SELECT COALESCE(sum(original_amount), 0) AS value FROM ledger_entries WHERE account_id = asset.ledger_account_id AND user_id = asset.user_id) balance
		LEFT JOIN LATERAL (SELECT owned_value FROM asset_valuations WHERE asset_id = asset.id ORDER BY valuation_date DESC, created_at DESC LIMIT 1) valuation ON true
		WHERE asset.user_id = $1 AND asset.archived_at IS NULL AND account.archived_at IS NULL`, userID)
	if err != nil {
		return nil, err
	}
	values := map[string]money.Amount{}
	type allocationValue struct{ label, currency, raw string }
	allocationValues := []allocationValue{}
	for rows.Next() {
		var allocation allocationValue
		if err := rows.Scan(&allocation.label, &allocation.currency, &allocation.raw); err != nil {
			rows.Close()
			return nil, err
		}
		allocationValues = append(allocationValues, allocation)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for _, allocation := range allocationValues {
		amount, _ := money.Parse(allocation.raw)
		converted, available, err := rates.convert(amount, allocation.currency, display, time.Now().UTC())
		if err != nil {
			return nil, err
		}
		if available {
			values[allocation.label] = values[allocation.label].Add(converted)
		}
	}
	return dashboardBreakdowns(values), nil
}

func dashboardNetWorthHistory(ctx context.Context, tx pgx.Tx, rates *dashboardRates, userID pgtype.UUID, display string, selected time.Time) ([]api.DashboardNetWorthPoint, error) {
	result := make([]api.DashboardNetWorthPoint, 0, 12)
	for offset := 0; offset < 12; offset++ {
		month := selected.AddDate(0, -(11 - offset), 0)
		end := month.AddDate(0, 1, -1)
		total := dashboardZero()
		rows, err := tx.Query(ctx, `SELECT account.currency::text, COALESCE(sum(entry.original_amount), 0)::text FROM ledger_accounts account LEFT JOIN ledger_entries entry ON entry.account_id = account.id AND entry.user_id = account.user_id AND EXISTS (SELECT 1 FROM ledger_transactions transaction WHERE transaction.id = entry.transaction_id AND transaction.user_id = entry.user_id AND transaction.posted_at IS NOT NULL AND transaction.event_date <= $2) WHERE account.user_id = $1 AND account.role = 'USER' GROUP BY account.id`, userID, end)
		if err != nil {
			return nil, err
		}
		type historicalBalance struct{ currency, raw string }
		balances := []historicalBalance{}
		for rows.Next() {
			var balance historicalBalance
			if err := rows.Scan(&balance.currency, &balance.raw); err != nil {
				rows.Close()
				return nil, err
			}
			balances = append(balances, balance)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
		for _, balance := range balances {
			amount, _ := money.Parse(balance.raw)
			converted, available, err := rates.convert(amount, balance.currency, display, end)
			if err != nil {
				return nil, err
			}
			if available {
				total = total.Add(converted)
			}
		}
		result = append(result, api.DashboardNetWorthPoint{Month: month.Format("2006-01"), NetWorth: total.String()})
	}
	return result, nil
}

func (rates *dashboardRates) convert(amount money.Amount, from, to string, date time.Time) (money.Amount, bool, error) {
	from, to = strings.ToUpper(from), strings.ToUpper(to)
	rates.date = date
	if from == to {
		return amount, true, nil
	}
	for _, currency := range []string{from, to} {
		if currency == "USD" {
			continue
		}
		if _, err := rates.lookup("USD", currency); err != nil {
			if errors.Is(err, fx.ErrUnavailable) {
				rates.missing[currency] = true
				return dashboardZero(), false, nil
			}
			return money.Amount{}, false, err
		}
	}
	value, err := fx.Convert(amount, from, to, rates.lookup)
	if err == nil {
		return value, true, nil
	}
	if errors.Is(err, fx.ErrUnavailable) {
		rates.missing[from] = true
		return dashboardZero(), false, nil
	}
	return money.Amount{}, false, err
}

func (rates *dashboardRates) lookup(base, quote string) (string, error) {
	key := base + ":" + quote + ":" + rates.date.Format("2006-01-02")
	if rate, ok := rates.cache[key]; ok {
		return rate, nil
	}
	var rate string
	var stale pgtype.Timestamptz
	err := rates.pool.QueryRow(rates.ctx, `SELECT rate::text, stale_at FROM fx_rates WHERE provider = 'YAHOO' AND base_currency = $1 AND quote_currency = $2 AND rate_date <= $3 ORDER BY rate_date DESC LIMIT 1`, base, quote, rates.date).Scan(&rate, &stale)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fx.ErrUnavailable
	}
	if err != nil {
		return "", err
	}
	if stale.Valid {
		rates.stale[quote] = true
	}
	rates.cache[key] = rate
	return rate, nil
}

func dashboardZero() money.Amount { value, _ := money.Parse("0"); return value }
func dashboardCurrencies(values map[string]bool) []api.Currency {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]api.Currency, 0, len(keys))
	for _, key := range keys {
		result = append(result, api.Currency(key))
	}
	return result
}
func dashboardBreakdowns(values map[string]money.Amount) []api.DashboardBreakdown {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]api.DashboardBreakdown, 0, len(keys))
	for _, key := range keys {
		result = append(result, api.DashboardBreakdown{Label: key, Value: values[key].String()})
	}
	return result
}
func dashboardPercent(numerator, denominator money.Amount) (string, error) {
	return fx.Percent(numerator, denominator)
}
