'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'charts.js'), 'utf8');
const context = { window: {}, Date, Math };
vm.runInNewContext(source, context);

test('keeps the equity chart data shape and renders a smooth gradient area', () => {
  const points = [
    { time: 100, value: 100 },
    { time: 200, value: 105 },
    { time: 300, value: 102 }
  ];
  const svg = context.window.GlubiCharts.equityCurve(points, value => `$${value}`);

  assert.match(svg, /aria-label="Evolución del capital virtual/);
  assert.match(svg, /<linearGradient id="equityFill"/);
  assert.match(svg, / C/);
  assert.match(svg, /stroke="var\(--acc\)"/);
});

test('renders signed activity bars from existing equity points without extra inputs', () => {
  const svg = context.window.GlubiCharts.activityBars([
    { time: 100, value: 100 },
    { time: 200, value: 104 },
    { time: 300, value: 101 }
  ], value => `${value} USDT`);

  assert.match(svg, /aria-label="Barras de variación del capital virtual"/);
  assert.match(svg, /url\(#activityGain\)/);
  assert.match(svg, /url\(#activityLoss\)/);
  assert.equal((svg.match(/<rect /g) || []).length, 2);
  assert.match(context.window.GlubiCharts.activityBars([], String), /más registros/);
});
