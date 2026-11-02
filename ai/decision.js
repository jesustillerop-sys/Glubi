'use strict';

const { resolveSignal } = require('../core/signals.js');

function applyValidatedModel(analysis, model) {
  if (!model || !model.qualified) return analysis;

  const points = model.probability >= 0.58 ? 1 : model.probability <= 0.42 ? -1 : 0;
  analysis.rows.push({
    name: 'TensorFlow.js',
    detail: `Prob. alcista ${model.horizon} velas ${(model.probability * 100).toFixed(0)}%; validación ${(model.accuracy * 100).toFixed(0)}% vs base ${(model.baseline * 100).toFixed(0)}% (${model.validationCount} casos)`,
    pts: points
  });
  analysis.score += points;

  const signal = resolveSignal({
    score: analysis.score,
    rr: analysis.rr,
    adx: analysis.adx,
    confluence: analysis.conf,
    againstHigherTimeframe: typeof analysis.ctx === 'string' && /BAJISTA/.test(analysis.ctx),
    higherTimeframe: analysis.ctx
  });
  analysis.decision = signal.decision;
  analysis.reason = signal.reason;
  return analysis;
}

module.exports = { applyValidatedModel };
