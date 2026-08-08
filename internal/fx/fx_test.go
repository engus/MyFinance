package fx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/engus/myfinance/internal/money"
)

func TestConvertUsesExactCachedUSDQuotes(t *testing.T) {
	amount, err := money.Parse("100")
	if err != nil {
		t.Fatal(err)
	}
	converted, err := Convert(amount, "EUR", "KZT", func(base, quote string) (string, error) {
		switch quote {
		case "EUR":
			return "0.8", nil
		case "KZT":
			return "500", nil
		}
		return "", ErrUnavailable
	})
	if err != nil {
		t.Fatal(err)
	}
	if converted.String() != "62500" {
		t.Fatalf("converted = %s, want 62500", converted.String())
	}
}

func TestYahooProviderFetchesDatedHistory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/USDEUR=X" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if request.URL.Query().Get("interval") != "1d" || request.URL.Query().Get("period1") == "" {
			t.Fatalf("unexpected history query: %s", request.URL.RawQuery)
		}
		_, _ = writer.Write([]byte(`{"chart":{"result":[{"timestamp":[1704067200,1704153600,1704240000],"indicators":{"quote":[{"close":[0.91,null,0.93]}]}}]}}`))
	}))
	defer server.Close()
	provider := NewYahooProvider(server.Client())
	provider.Endpoint = server.URL
	start := time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2024, time.January, 3, 0, 0, 0, 0, time.UTC)
	snapshots, err := provider.FetchHistory(context.Background(), "USD", "EUR", start, end)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 2 || snapshots[0].Rate != "0.91" || snapshots[1].Date.Format("2006-01-02") != "2024-01-03" {
		t.Fatalf("unexpected history: %#v", snapshots)
	}
}

func TestYahooProviderUsesLastNonNullClose(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/USDKZT=X" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		_, _ = writer.Write([]byte(`{"chart":{"result":[{"timestamp":[1704067200,1704153600],"indicators":{"quote":[{"close":[null,499.125]}]}}]}}`))
	}))
	defer server.Close()
	provider := NewYahooProvider(server.Client())
	provider.Endpoint = server.URL
	snapshot, err := provider.Fetch(context.Background(), "USD", "KZT")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Rate != "499.125" || snapshot.Date.Format("2006-01-02") != "2024-01-02" {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
}
