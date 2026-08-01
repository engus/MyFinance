import { RateProvider } from './rateProvider';

const YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

export class YahooRateProvider implements RateProvider {
  async getRate(fromSymbol: string, toSymbol: string): Promise<number> {
    if (fromSymbol === toSymbol) return 1;

    const pairSymbol = `${fromSymbol}${toSymbol}=X`;
    const response = await fetch(`${YAHOO_QUOTE_URL}/${pairSymbol}`);
    if (!response.ok) {
      throw new Error(`Yahoo Finance request failed: ${response.status}`);
    }
    const data = (await response.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    };
    const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof price !== 'number') {
      throw new Error(`Yahoo Finance response missing price for ${pairSymbol}`);
    }
    return price;
  }
}
