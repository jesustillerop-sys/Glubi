'use strict';

const fs = require('fs');
const path = require('path');
const adaptiveRisk = require('./adaptive_risk.js');

const TF = new Set(['5m', '15m', '30m', '1h', '4h', '1d']);
const SYMBOL = /^[A-Z0-9_]{2,28}USDT$/;
const DEFAULTS = { initialBalance: 100, riskPct: 1, feePct: 0.1, slippagePct: 0.05, autoTrade: true, autoTradePolicyVersion: 1 };

module.exports = function createPaper({ dir, analyze, market, database, onTrade = async () => {} }) {
  const file = path.join(dir, 'paper_portfolio.json');
  const copy = value => JSON.parse(JSON.stringify(value));
  const now = () => Math.floor(Date.now() / 1000);
  const sum = values => values.reduce((total, value) => total + value, 0);

  function blank() {
    return {
      version: 1,
      cfg: { ...DEFAULTS },
      balance: DEFAULTS.initialBalance,
      open: [],
      trades: [],
      learning: adaptiveRisk.createLearning(),
      nextId: 1,
      createdAt: now(),
      updatedAt: now()
    };
  }

  let autoTradeMigrationNeeded = false;
  function load() {
    let value;
    if (database) {
      value = database.readJSON('paper_portfolio.json', null);
      if (value === null) return blank();
    } else try {
      value = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return blank();
      throw new Error(`No se pudo leer paper_portfolio.json: ${error.message}`);
    }
    if (!value || value.version !== 1 || !value.cfg || !Number.isFinite(value.balance) ||
        !Array.isArray(value.open) || !Array.isArray(value.trades) || !Number.isInteger(value.nextId)) {
      throw new Error('paper_portfolio.json tiene un formato inválido; no se modificó.');
    }
    const cfg = { ...DEFAULTS, ...value.cfg };
    if (value.cfg.autoTradePolicyVersion !== DEFAULTS.autoTradePolicyVersion) {
      cfg.autoTrade = true;
      cfg.autoTradePolicyVersion = DEFAULTS.autoTradePolicyVersion;
      autoTradeMigrationNeeded = true;
    }
    return {
      ...value,
      cfg,
      open: value.open,
      trades: value.trades,
      learning: adaptiveRisk.normalizeLearning(value.learning)
    };
  }

  let state = load();
  const opening = new Set(), closing = new Set();

  function commit(next) {
    next.updatedAt = now();
    if (database) {
      database.writeJSON('paper_portfolio.json', next);
      state = next;
      return;
    }
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(next, null, 2));
    fs.renameSync(temp, file);
    state = next;
  }

  function feeRate(position) {
    return position.feePct / 100;
  }

  function markValues(position, price) {
    const slip = position.slippagePct / 100;
    const exitPrice = Math.max(0, price * (position.side === 'long' ? 1 - slip : 1 + slip));
    const rawPnl = position.side === 'long'
      ? position.quantity * (exitPrice - position.entryPrice)
      : position.quantity * (position.entryPrice - exitPrice);
    const grossPnl = position.side === 'short' ? Math.max(rawPnl, -position.notional) : rawPnl;
    const exitFee = position.quantity * exitPrice * feeRate(position);
    const returned = Math.max(0, position.notional + grossPnl - exitFee);
    return { exitPrice, grossPnl, exitFee, returned };
  }

  function closeIn(next, id, price, reason) {
    const index = next.open.findIndex(position => position.id === id);
    if (index < 0) throw new Error('La operación simulada ya no está abierta.');
    const position = next.open[index];
    const values = markValues(position, price);
    const pnl = values.returned - position.notional - position.entryFee;
    const initialStop = Number.isFinite(position.initialStop) ? position.initialStop : position.stop;
    const initialRisk = position.quantity * Math.abs(position.entryPrice - initialStop);
    const trade = {
      id: position.id,
      symbol: position.symbol,
      side: position.side,
      tf: position.tf,
      entryPrice: position.entryPrice,
      exitPrice: values.exitPrice,
      stop: position.stop,
      target: position.target,
      notional: position.notional,
      entryFee: position.entryFee,
      exitFee: values.exitFee,
      pnl,
      initialStop,
      rMultiple: Number.isFinite(initialRisk) && initialRisk > 0 ? pnl / initialRisk : null,
      trailAtrMultiplier: position.trailAtrMultiplier || next.learning.atrMultiplier,
      reason,
      openedAt: position.openedAt,
      closedAt: now()
    };
    next.balance += values.returned;
    next.open.splice(index, 1);
    next.trades.unshift(trade);
    next.trades.length = Math.min(next.trades.length, 5000);
    adaptiveRisk.recordStopOutcome(next.learning, trade);
    return trade;
  }

  async function notifyExecution(event) {
    try {
      await onTrade({ kind: 'paper-execution', ...event, equity: summary().equity, balance: state.balance });
    } catch (error) {
      console.error(`Paper trading: no se pudo notificar la ejecución de ${event.symbol}: ${error.message}`);
    }
  }

  if (autoTradeMigrationNeeded) commit(copy(state));

  function summary() {
    const openPositions = state.open.map(position => {
      const markPrice = Number.isFinite(position.markPrice) ? position.markPrice : position.entryPrice;
      const values = markValues(position, markPrice);
      return {
        ...position,
        markPrice,
        unrealizedPnl: values.returned - position.notional - position.entryFee
      };
    });
    const unrealizedPnl = sum(openPositions.map(position => position.unrealizedPnl));
    const equity = state.balance + sum(openPositions.map(position =>
      position.notional + position.unrealizedPnl + position.entryFee));
    const realizedPnl = sum(state.trades.map(trade => trade.pnl));
    const wins = state.trades.filter(trade => trade.pnl > 0);
    const losses = state.trades.filter(trade => trade.pnl < 0);
    const grossWins = sum(wins.map(trade => trade.pnl));
    const grossLosses = -sum(losses.map(trade => trade.pnl));
    const chronologicalTrades = [...state.trades].reverse();
    const equityCurve = [{ time: state.createdAt, value: state.cfg.initialBalance }];
    let curveValue = state.cfg.initialBalance;
    for (const trade of chronologicalTrades) {
      curveValue += trade.pnl;
      const time = Math.max(trade.closedAt, equityCurve[equityCurve.length - 1].time + 1);
      equityCurve.push({ time, value: curveValue });
    }
    if (openPositions.length || !chronologicalTrades.length) equityCurve.push({
      time: Math.max(now(), equityCurve[equityCurve.length - 1].time + 1),
      value: equity
    });
    return {
      cfg: { ...state.cfg },
      balance: state.balance,
      equity,
      realizedPnl,
      unrealizedPnl,
      wins: wins.length,
      losses: losses.length,
      equityCurve,
      roi: state.cfg.initialBalance > 0 ? (equity / state.cfg.initialBalance - 1) * 100 : 0,
      openCount: openPositions.length,
      tradeCount: state.trades.length,
      stopLearning: adaptiveRisk.summary(state.learning),
      winRate: state.trades.length ? wins.length / state.trades.length : null,
      profitFactor: grossLosses ? grossWins / grossLosses : null,
      openPositions,
      trades: state.trades.slice(0, 20)
    };
  }

  function configure(input) {
    const next = copy(state);
    const initialBalance = Number(input.initialBalance);
    if (input.initialBalance != null && (!Number.isFinite(initialBalance) || initialBalance <= 0)) {
      throw new Error('El capital inicial debe ser mayor que cero.');
    }
    if (input.initialBalance != null) {
      if (next.open.length || next.trades.length) {
        if (Math.abs(initialBalance - next.cfg.initialBalance) > 1e-9) {
          throw new Error('El capital inicial no se puede cambiar después de iniciar operaciones simuladas.');
        }
      } else {
        next.cfg.initialBalance = initialBalance;
        next.balance = initialBalance;
      }
    }
    const riskPct = Number(input.riskPct);
    const feePct = Number(input.feePct);
    const slippagePct = Number(input.slippagePct);
    if (input.riskPct != null && (!Number.isFinite(riskPct) || riskPct < 0.1 || riskPct > 5)) {
      throw new Error('El riesgo debe estar entre 0.1% y 5%.');
    }
    if (input.feePct != null && (!Number.isFinite(feePct) || feePct < 0 || feePct > 1)) {
      throw new Error('La comisión debe estar entre 0% y 1%.');
    }
    if (input.slippagePct != null && (!Number.isFinite(slippagePct) || slippagePct < 0 || slippagePct > 1)) {
      throw new Error('El deslizamiento debe estar entre 0% y 1%.');
    }
    if (input.autoTrade != null && !['0', '1', 'true', 'false', true, false].includes(input.autoTrade)) {
      throw new Error('La opción de trading automático no es válida.');
    }
    if (input.riskPct != null) next.cfg.riskPct = riskPct;
    if (input.feePct != null) next.cfg.feePct = feePct;
    if (input.slippagePct != null) next.cfg.slippagePct = slippagePct;
    if (input.autoTrade != null) next.cfg.autoTrade = input.autoTrade === '1' || input.autoTrade === 'true' || input.autoTrade === true;
    commit(next);
    return summary();
  }

  async function open({ symbol, tf, side, source = 'manual' }) {
    if (!SYMBOL.test(symbol || '') || !TF.has(tf)) throw new Error('Símbolo o período inválido.');
    if (side !== 'long' && side !== 'short') throw new Error('Lado de operación inválido.');
    if (side === 'short' && market(symbol) !== 'F') {
      throw new Error('Las ventas simuladas en corto solo están disponibles para futuros USDⓈ-M.');
    }
    if (opening.has(symbol)) throw new Error('Ya se está preparando una operación para esta moneda.');
    if (state.open.some(position => position.symbol === symbol)) {
      throw new Error('Ya existe una operación simulada abierta para esta moneda.');
    }

    opening.add(symbol);
    try {
      const analysis = await analyze(symbol, tf);
      const expectedDecision = side === 'long' ? 'COMPRAR' : 'VENDER';
      if (analysis.decision !== expectedDecision) {
        throw new Error(`La señal cambió a ${analysis.decision || 'sin confirmación'}; se canceló la operación simulada.`);
      }
      const entryPrice = analysis.price * (side === 'long'
        ? 1 + state.cfg.slippagePct / 100
        : 1 - state.cfg.slippagePct / 100);
      const stop = side === 'long' ? analysis.stop : analysis.stop_s;
      const target = side === 'long' ? analysis.target : analysis.target_s;
      if (!Number.isFinite(entryPrice) || entryPrice <= 0 ||
          !Number.isFinite(stop) || !Number.isFinite(target) ||
          (side === 'long' ? !(stop < entryPrice && target > entryPrice) : !(stop > entryPrice && target < entryPrice))) {
        throw new Error('El análisis no ofrece un stop y un objetivo válidos para simular esta operación.');
      }

      const riskBudget = state.balance * state.cfg.riskPct / 100;
      const stopDistance = Math.abs(entryPrice - stop) / entryPrice;
      const requestedNotional = riskBudget / stopDistance;
      const fee = state.cfg.feePct / 100;
      const notional = Math.min(requestedNotional, state.balance / (1 + fee));
      if (!Number.isFinite(notional) || notional <= 0) throw new Error('No hay saldo virtual disponible.');

      const next = copy(state);
      const position = {
        id: next.nextId++,
        symbol,
        side,
        tf,
        entryPrice,
        markPrice: analysis.price,
        initialStop: stop,
        stop,
        target,
        peakPrice: entryPrice,
        trailAtrMultiplier: state.learning.atrMultiplier,
        notional,
        quantity: notional / entryPrice,
        entryFee: notional * fee,
        feePct: next.cfg.feePct,
        slippagePct: next.cfg.slippagePct,
        openedAt: now()
      };
      next.balance -= notional + position.entryFee;
      next.open.unshift(position);
      commit(next);
      await notifyExecution({
        action: side === 'long' ? 'COMPRA' : 'VENTA',
        phase: 'apertura',
        source,
        symbol,
        tf,
        side,
        price: entryPrice,
        stop,
        target,
        notional,
        reason: 'Señal confirmada y operación simulada abierta.'
      });
      return position;
    } finally {
      opening.delete(symbol);
    }
  }

  async function close(id) {
    const position = state.open.find(item => item.id === id);
    if (!position) throw new Error('No se encontró la operación simulada abierta.');
    if (closing.has(id)) throw new Error('La operación simulada ya se está cerrando.');
    closing.add(id);
    try {
    const analysis = await analyze(position.symbol, position.tf);
    if (!Number.isFinite(analysis.price) || analysis.price <= 0) throw new Error('No se obtuvo un precio válido para cerrar.');
    const next = copy(state);
    const trade = closeIn(next, id, analysis.price, 'manual');
    commit(next);
    await notifyExecution({
      action: position.side === 'long' ? 'VENTA' : 'COMPRA',
      phase: 'cierre',
      source: 'manual',
      symbol: trade.symbol,
      tf: trade.tf,
      side: trade.side,
      price: trade.exitPrice,
      entryPrice: trade.entryPrice,
      stop: trade.stop,
      target: trade.target,
      notional: trade.notional,
      pnl: trade.pnl,
      reason: trade.reason
    });
    return trade;
    } finally {
      closing.delete(id);
    }
  }

  async function onSignal({ symbol, tf, decision }) {
    if (!state.cfg.autoTrade) return null;
    const existing = state.open.find(position => position.symbol === symbol);
    if (existing) {
      const opposingDecision = existing.side === 'long' ? 'VENDER' : 'COMPRAR';
      if (decision !== opposingDecision || closing.has(existing.id)) return null;
      closing.add(existing.id);
      try {
        const analysis = await analyze(symbol, tf);
        if (analysis.decision !== decision || !Number.isFinite(analysis.price) || analysis.price <= 0) return null;
        const next = copy(state);
        const trade = closeIn(next, existing.id, analysis.price, 'señal opuesta confirmada');
        commit(next);
        await notifyExecution({
          action: existing.side === 'long' ? 'VENTA' : 'COMPRA',
          phase: 'cierre',
          source: 'señal confirmada',
          symbol: trade.symbol,
          tf: trade.tf,
          side: trade.side,
          price: trade.exitPrice,
          entryPrice: trade.entryPrice,
          stop: trade.stop,
          target: trade.target,
          notional: trade.notional,
          pnl: trade.pnl,
          reason: trade.reason
        });
        return trade;
      } catch (error) {
        console.error(`Paper trading: no se pudo cerrar ${symbol} por señal confirmada: ${error.message}`);
        return null;
      } finally {
        closing.delete(existing.id);
      }
    }
    const side = decision === 'COMPRAR' ? 'long'
      : decision === 'VENDER' && market(symbol) === 'F' ? 'short'
        : null;
    if (!side) return null;
    try {
      return await open({ symbol, tf, side, source: 'señal confirmada' });
    } catch (error) {
      console.error(`Paper trading: señal ${symbol} ${tf} no abierta: ${error.message}`);
      return null;
    }
  }

  async function monitor() {
    const marks = [];
    for (const position of state.open) {
      try {
        const analysis = await analyze(position.symbol, position.tf);
        const price = analysis.price;
        if (!Number.isFinite(price) || price <= 0) throw new Error('Precio de mercado inválido.');
        marks.push({ id: position.id, price, atr: analysis.atr });
      } catch (error) {
        console.error(`Paper trading: no se pudo actualizar ${position.symbol}: ${error.message}`);
      }
    }
    if (marks.length) {
      const next = copy(state);
      const closedTrades = [];
      for (const mark of marks) {
        const current = next.open.find(item => item.id === mark.id);
        if (!current) continue;
        current.markPrice = mark.price;
        if (!Number.isFinite(current.initialStop)) current.initialStop = current.stop;
        if (!Number.isFinite(current.peakPrice)) current.peakPrice = current.markPrice;
        if (!Number.isFinite(current.trailAtrMultiplier)) {
          current.trailAtrMultiplier = next.learning.atrMultiplier;
        }
        const trailing = adaptiveRisk.trailStop({
          side: current.side,
          initialStop: current.initialStop,
          currentStop: current.stop,
          peakPrice: current.peakPrice,
          price: mark.price,
          atr: mark.atr,
          multiplier: current.trailAtrMultiplier
        });
        current.stop = trailing.stop;
        current.peakPrice = trailing.peakPrice;
        const stopped = current.side === 'long' ? mark.price <= current.stop : mark.price >= current.stop;
        const targeted = current.side === 'long' ? mark.price >= current.target : mark.price <= current.target;
        if (stopped || targeted) {
          const reason = stopped ? 'stop' : 'objetivo';
          closedTrades.push(closeIn(next, current.id, stopped ? mark.price : current.target, reason));
        }
      }
      try {
        if (marks.some(mark => next.open.some(position => position.id === mark.id) ||
            closedTrades.some(trade => trade.id === mark.id))) commit(next);
        for (const trade of closedTrades) {
          await notifyExecution({
            action: trade.side === 'long' ? 'VENTA' : 'COMPRA',
            phase: 'cierre',
            source: 'stop/objetivo',
            symbol: trade.symbol,
            tf: trade.tf,
            side: trade.side,
            price: trade.exitPrice,
            entryPrice: trade.entryPrice,
            stop: trade.stop,
            target: trade.target,
            notional: trade.notional,
            pnl: trade.pnl,
            reason: trade.reason
          });
        }
      } catch (error) {
        console.error(`Paper trading: no se pudo guardar la cartera virtual: ${error.message}`);
        throw error;
      }
    }
  }

  return { summary, configure, open, close, onSignal, monitor };
};
