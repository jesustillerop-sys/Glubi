'use strict';

module.exports = function createTelegramNotifier({ env = process.env, request = fetch, logger = console } = {}) {
  function isConfigured() {
    return Boolean(env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT_ID);
  }

  function notify(event, formatPrice) {
    const token = env.TELEGRAM_TOKEN, chat = env.TELEGRAM_CHAT_ID;
    if (!token || !chat || !event || event.kind !== 'paper-execution' ||
        !['COMPRA', 'VENTA'].includes(event.action) || !['apertura', 'cierre'].includes(event.phase)) {
      return Promise.resolve(false);
    }

    const side = event.side === 'short' ? 'corto' : 'largo';
    const pnl = Number.isFinite(event.pnl) ? `\nPNL neto simulado: ${formatPrice(event.pnl)} USDT` : '';
    const text = [
      `GLUBI PAPER · ${event.action} ${event.phase.toUpperCase()} CONFIRMADA`,
      `${event.symbol} ${event.tf} · ${side}`,
      `Precio: ${formatPrice(event.price)} USDT${event.entryPrice == null ? '' : ` · entrada: ${formatPrice(event.entryPrice)} USDT`}`,
      `Stop: ${formatPrice(event.stop)} · objetivo: ${formatPrice(event.target)}`,
      `Nocional: ${formatPrice(event.notional)} USDT · capital virtual: ${formatPrice(event.equity)} USDT`,
      event.reason || '',
      pnl,
      'SIMULACIÓN: no se enviaron órdenes reales a Binance.'
    ].filter(Boolean).join('\n');
    return request(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ chat_id: chat, text }),
      signal: AbortSignal.timeout(10000)
    })
      .then(async response => {
        if (!response.ok) throw new Error('Telegram respondió ' + response.status);
        const result = await response.json();
        if (!result.ok) throw new Error(result.description || 'Telegram rechazó la alerta');
        return true;
      })
      .catch(error => {
        const message = String(error.message || error).replaceAll(token, '[redacted]');
        logger.error('No se pudo enviar la alerta de Telegram:', message);
        return false;
      });
  }

  notify.isConfigured = isConfigured;
  return notify;
};
