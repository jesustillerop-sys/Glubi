'use strict';

const API = 'https://fapi.binance.com/fapi/v1';

module.exports = function createUsdMExchange({ get }) {
  const normalize = candle => [
    Math.floor(+candle[0] / 1000), +candle[1], +candle[2],
    +candle[3], +candle[4], +candle[5]
  ];

  return {
    exchangeInfo: () => get(`${API}/exchangeInfo`, 1800),
    tickers: () => get(`${API}/ticker/24hr`, 120),
    async klines(symbol, interval, limit) {
      const candles = await get(`${API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      return candles.map(normalize);
    }
  };
};
