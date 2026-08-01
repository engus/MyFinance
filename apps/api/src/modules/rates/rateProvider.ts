export interface RateProvider {
  getRate(fromSymbol: string, toSymbol: string): Promise<number>;
}
