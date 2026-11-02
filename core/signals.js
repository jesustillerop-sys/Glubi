'use strict';

function resolveSignal({ score, rr, adx, confluence, againstHigherTimeframe, higherTimeframe }) {
  const formattedScore = score >= 0 ? `+${score}` : `${score}`;
  let decision, reason;
  if (confluence.bear >= 3 && score <= -4) {
    [decision, reason] = ['VENDER', `Puntaje ${formattedScore} y ${confluence.bear} de 5 señales bajistas: sal de la posición o no compres.`];
  } else if (score >= 5 && confluence.bull >= 3) {
    if (rr < 1.5) [decision, reason] = ['ESPERAR', `Puntaje ${formattedScore} y ${confluence.bull} señales alcistas, pero R/R ${rr.toFixed(1)} es menor a 1.5.`];
    else if (adx < 20) [decision, reason] = ['ESPERAR', `Puntaje ${formattedScore}, pero el mercado está lateral (ADX ${adx.toFixed(0)} bajo 20).`];
    else if (againstHigherTimeframe) [decision, reason] = ['ESPERAR', `Puntaje ${formattedScore}, pero va contra la temporalidad superior (${higherTimeframe}).`];
    else [decision, reason] = ['COMPRAR', `Puntaje ${formattedScore}, ${confluence.bull} de 5 señales alcistas, ADX ${adx.toFixed(0)} y R/R ${rr.toFixed(1)}.`];
  } else {
    [decision, reason] = ['ESPERAR', `Puntaje ${formattedScore} con ${confluence.bull} señales alcistas y ${confluence.bear} bajistas de 5: sin confluencia suficiente.`];
  }
  return { decision, reason };
}

module.exports = { resolveSignal };
