'use strict';

const TOKENS_API = 'https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list';
const ALPHA_API = 'https://www.binance.com/bapi/defi/v1/public/alpha-trade';

module.exports = function createAlphaExchange({ get }) {
  return {
    tokens: () => get(TOKENS_API, 1800),
    async klines(symbol, interval, limit) {
      const response = await get(`${ALPHA_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      const candles = response && Array.isArray(response.data) ? response.data : null;
      if (!candles || !candles.length) {
        throw new Error(`Binance Alpha no devolvió velas para ${symbol}`);
      }
      return candles.map(candle => [
        Math.floor(+candle[0] / 1000), +candle[1], +candle[2],
        +candle[3], +candle[4], +candle[5]
      ]);
    },
    list(response, isValidSymbol, spotSymbols, futureSymbols) {
      const tokens = Array.isArray(response && response.data)
        ? response.data
        : ((response && response.data && response.data.tokens) || []);
      const result = new Map();
      for (const token of tokens) {
        const id = token.alphaId || token.tokenId;
        if (!id || !token.symbol) continue;
        const marketSymbol = `${id}USDT`;
        const baseSymbol = `${String(token.symbol).toUpperCase()}USDT`;
        if (!isValidSymbol.test(marketSymbol) || spotSymbols.has(baseSymbol) || futureSymbols.has(baseSymbol)) continue;
        result.set(marketSymbol, {
          name: String(token.symbol).toUpperCase(),
          vol: +token.volume24h || 0,
          chg: +token.percentChange24h || 0
        });
      }
      return result;
    }
  };
};
