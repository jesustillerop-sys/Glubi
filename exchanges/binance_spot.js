'use strict';

module.exports = function createSpotExchange({ get, base }) {
  const normalize = candle => [
    Math.floor(+candle[0] / 1000), +candle[1], +candle[2],
    +candle[3], +candle[4], +candle[5]
  ];

  return {
    symbols: () => get(`${base}/ticker/price`, 300),
    tickers: () => get(`${base}/ticker/24hr`, 120),
    async klines(symbol, interval, limit) {
      const candles = await get(`${base}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      return candles.map(normalize);
    }
  };
};
