import { RateProvider } from './rateProvider';

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const REQUEST_TIMEOUT_MS = 8_000;

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; currency?: string };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
}

async function fetchChart(symbol: string, date: Date): Promise<YahooChartResponse> {
  const start = Math.floor(date.getTime() / 1000) - 86_400 * 5;
  const end = Math.floor(date.getTime() / 1000) + 86_400 * 2;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = new URL(`${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}`);
    url.searchParams.set('period1', String(start));
    url.searchParams.set('period2', String(end));
    url.searchParams.set('interval', '1d');
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Yahoo request failed: ${response.status}`);
    return (await response.json()) as YahooChartResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function lastClose(
  data: YahooChartResponse,
  onOrBefore: Date
): { price: number; timestamp?: number; currency?: string } {
  const result = data.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const endOfValueDate = Math.floor(onOrBefore.getTime() / 1000) + 86_399;
  for (let index = closes.length - 1; index >= 0; index -= 1) {
    const value = closes[index];
    const timestamp = result?.timestamp?.[index];
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (!timestamp || timestamp <= endOfValueDate)
    ) {
      return {
        price: value,
        timestamp: result?.timestamp?.[index],
        currency: result?.meta?.currency,
      };
    }
  }
  const live = result?.meta?.regularMarketPrice;
  if (
    Math.abs(Date.now() - onOrBefore.getTime()) < 2 * 86_400_000 &&
    typeof live === 'number' &&
    Number.isFinite(live)
  ) {
    return { price: live, currency: result?.meta?.currency };
  }
  throw new Error('Yahoo response did not contain a price');
}

export class YahooRateProvider implements RateProvider {
  async getRate(fromCurrency: string, toCurrency: string, date: Date): Promise<number> {
    if (fromCurrency === toCurrency) return 1;
    return lastClose(await fetchChart(`${fromCurrency}${toCurrency}=X`, date), date).price;
  }
}
