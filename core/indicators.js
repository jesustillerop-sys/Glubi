'use strict';

const sum = values => values.reduce((total, value) => total + value, 0);
const max = values => values.reduce((highest, value) => value > highest ? value : highest);
const min = values => values.reduce((lowest, value) => value < lowest ? value : lowest);
const sign = value => (value >= 0 ? '+' : '') + value;
const format = value => {
  const absolute = Math.abs(value);
  return absolute >= 100
    ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : absolute >= 1 ? value.toFixed(4) : value.toFixed(6);
};

function ema(values, period) {
  const alpha = 2 / (period + 1);
  let value = values[0];
  return values.map(item => (value = item * alpha + value * (1 - alpha)));
}

function rsi(closes, period = 14) {
  const result = new Array(closes.length).fill(50);
  if (closes.length <= period) return result;
  let gains = 0, losses = 0;
  for (let index = 1; index <= period; index++) {
    const change = closes[index] - closes[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  gains /= period;
  losses /= period;
  result[period] = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  for (let index = period + 1; index < closes.length; index++) {
    const change = closes[index] - closes[index - 1];
    gains = (gains * (period - 1) + Math.max(change, 0)) / period;
    losses = (losses * (period - 1) + Math.max(-change, 0)) / period;
    result[index] = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  }
  return result;
}

function atr(highs, lows, closes, period = 14) {
  const trueRanges = [highs[0] - lows[0]];
  for (let index = 1; index < closes.length; index++) {
    trueRanges.push(Math.max(
      highs[index] - lows[index],
      Math.abs(highs[index] - closes[index - 1]),
      Math.abs(lows[index] - closes[index - 1])
    ));
  }
  let average = sum(trueRanges.slice(0, period)) / period;
  for (const range of trueRanges.slice(period)) average = (average * (period - 1) + range) / period;
  return average;
}

function adx(highs, lows, closes, period = 14) {
  const length = closes.length, adxValues = new Array(length).fill(0);
  const plusDi = adxValues.slice(), minusDi = adxValues.slice();
  if (length < 2 * period + 2) return { adx: adxValues, plusDi, minusDi };
  const ranges = [0], positive = [0], negative = [0];
  for (let index = 1; index < length; index++) {
    const up = highs[index] - highs[index - 1], down = lows[index - 1] - lows[index];
    ranges.push(Math.max(highs[index] - lows[index], Math.abs(highs[index] - closes[index - 1]), Math.abs(lows[index] - closes[index - 1])));
    positive.push(up > down && up > 0 ? up : 0);
    negative.push(down > up && down > 0 ? down : 0);
  }
  let sumRange = sum(ranges.slice(1, period + 1));
  let sumPositive = sum(positive.slice(1, period + 1));
  let sumNegative = sum(negative.slice(1, period + 1));
  const directional = [];
  for (let index = period; index < length; index++) {
    if (index > period) {
      sumRange = sumRange - sumRange / period + ranges[index];
      sumPositive = sumPositive - sumPositive / period + positive[index];
      sumNegative = sumNegative - sumNegative / period + negative[index];
    }
    const positiveIndex = sumRange ? 100 * sumPositive / sumRange : 0;
    const negativeIndex = sumRange ? 100 * sumNegative / sumRange : 0;
    plusDi[index] = positiveIndex;
    minusDi[index] = negativeIndex;
    directional[index] = positiveIndex + negativeIndex === 0
      ? 0
      : 100 * Math.abs(positiveIndex - negativeIndex) / (positiveIndex + negativeIndex);
  }
  let average = sum(directional.slice(period, 2 * period)) / period;
  adxValues[2 * period - 1] = average;
  for (let index = 2 * period; index < length; index++) {
    average = (average * (period - 1) + directional[index]) / period;
    adxValues[index] = average;
  }
  return { adx: adxValues, plusDi, minusDi };
}

function macd(closes) {
  const fast = ema(closes, 12), slow = ema(closes, 26);
  const line = fast.map((value, index) => value - slow[index]);
  const signal = ema(line, 9);
  return { line, signal, histogram: line.map((value, index) => value - signal[index]) };
}

function swings(highs, lows, offset, width = 6) {
  const result = [];
  for (let index = width; index < highs.length - width; index++) {
    if (highs[index] === max(highs.slice(index - width, index + width + 1))) result.push([index + offset, highs[index], 'H']);
    if (lows[index] === min(lows.slice(index - width, index + width + 1))) result.push([index + offset, lows[index], 'L']);
  }
  return result;
}

function clusters(swingsList, averageRange, price) {
  const groups = [];
  for (const value of swingsList.map(point => point[1]).sort((a, b) => a - b)) {
    if (groups.length && value - groups[groups.length - 1].at(-1) <= 0.6 * averageRange) groups[groups.length - 1].push(value);
    else groups.push([value]);
  }
  const levels = groups.map(group => [sum(group) / group.length, group.length]);
  const compare = (left, right) => left[0] - right[0] || left[1] - right[1];
  return [
    levels.filter(level => level[0] > price).sort(compare).slice(0, 3),
    levels.filter(level => level[0] <= price).sort((left, right) => compare(right, left)).slice(0, 3)
  ];
}

function trendline(swingsList, kind, averageRange, length, times) {
  const points = swingsList.filter(point => point[2] === kind).slice(-3);
  if (points.length < 3) return null;
  const [first, middle, last] = points;
  const slope = (last[1] - first[1]) / (last[0] - first[0]);
  if (Math.abs(first[1] + slope * (middle[0] - first[0]) - middle[1]) > 0.5 * averageRange ||
      (kind === 'L' && slope <= 0) || (kind === 'H' && slope >= 0)) return null;
  const current = first[1] + slope * (length - 1 - first[0]);
  return { kind, t1: times[first[0]], p1: first[1], t2: times[length - 1], p2: current, now: current };
}

module.exports = {
  sum, max, min, sign, format, ema, rsi, atr, adx, macd, swings, clusters, trendline
};
