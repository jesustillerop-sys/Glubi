'use strict';

function extractFeatures(index, data) {
  const { close, volume, ema50, ema200, rsi, adx, plusDi, minusDi, macdHistogram } = data;
  let averageVolume = 0;
  for (let i = index - 20; i < index; i++) averageVolume += volume[i];
  averageVolume /= 20;

  return [
    (close[index] / ema50[index] - 1) * 10,
    (ema50[index] / ema200[index] - 1) * 10,
    (rsi[index] - 50) / 50,
    adx[index] / 50,
    (plusDi[index] - minusDi[index]) / 50,
    macdHistogram[index] / close[index] * 1000,
    Math.min(averageVolume ? volume[index] / averageVolume : 1, 3) - 1,
    (close[index] / close[index - 5] - 1) * 10,
    (close[index] / close[index - 20] - 1) * 5,
    (close[index] / close[index - 1] - 1) * 50
  ];
}

function createTrainingSamples(data, length, horizon) {
  const samples = [];
  for (let index = 60; index < length - horizon; index++) {
    const features = extractFeatures(index, data);
    const label = data.close[index + horizon] > data.close[index] ? 1 : 0;
    if (features.every(Number.isFinite)) samples.push({ features, label });
  }
  return samples;
}

module.exports = { extractFeatures, createTrainingSamples };
