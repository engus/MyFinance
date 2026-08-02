export interface RateProvider {
  getRate(fromCurrency: string, toCurrency: string, date: Date): Promise<number>;
}
