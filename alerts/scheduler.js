'use strict';

module.exports = function createSignalScheduler({ windowSeconds = 30 } = {}) {
  const pending = new Map();
  const entries = new Set(['COMPRAR', 'VENDER']);

  function observe({ symbol, tf, decision, stepSeconds, nowSeconds, confirmed }) {
    if (!symbol || !tf || !Number.isInteger(stepSeconds) || stepSeconds <= 0 ||
        !Number.isFinite(nowSeconds) || typeof confirmed !== 'boolean') {
      throw new Error('Datos inválidos para programar la confirmación de señal.');
    }

    const key = `${symbol}|${tf}`;
    const closeAt = (Math.floor(nowSeconds / stepSeconds) + 1) * stepSeconds;
    const remaining = closeAt - nowSeconds;
    const events = [];
    const previous = pending.get(key);

    if (previous && nowSeconds >= previous.closeAt && confirmed) {
      pending.delete(key);
      events.push({
        type: decision === previous.decision ? 'CONFIRMADA' : 'CANCELADA',
        symbol,
        tf,
        decision,
        previousDecision: previous.decision,
        closeAt: previous.closeAt
      });
    }

    if (!pending.has(key) && entries.has(decision) && remaining <= windowSeconds && remaining > 0) {
      const preparation = { decision, closeAt };
      pending.set(key, preparation);
      events.push({
        type: 'PREPARAR',
        symbol,
        tf,
        decision,
        closeAt
      });
    }

    return events;
  }

  return { observe };
};
