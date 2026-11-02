'use strict';

window.GlubiCharts = {
  equityCurve(points, format) {
    if (!points.length) {
      return '<div class="chart-empty">El historial de capital aún no está disponible.</div>';
    }
    if (points.length === 1) {
      const value = format(points[0].value);
      return `<div class="chart-empty"><div><svg viewBox="0 0 720 150" role="img" aria-label="Capital inicial ${value}"><path d="M24 110H696" stroke="var(--line)" stroke-width="1"/><circle cx="696" cy="110" r="5" fill="var(--acc)"/></svg><b>${value}</b><br>Capital inicial. La curva se formará al cerrar operaciones simuladas.</div></div>`;
    }

    const width = 720, height = 190, left = 34, right = 12, top = 12, bottom = 24;
    const minimum = Math.min(...points.map(point => point.value));
    const maximum = Math.max(...points.map(point => point.value));
    const span = maximum - minimum || Math.max(Math.abs(maximum) * 0.02, 1);
    const firstTime = points[0].time, timeSpan = points[points.length - 1].time - firstTime || 1;
    const coordinates = points.map(point => [
      left + (point.time - firstTime) / timeSpan * (width - left - right),
      top + (maximum - point.value) / span * (height - top - bottom)
    ]);
    const line = smoothPath(coordinates);
    const area = `${line} L ${coordinates.at(-1)[0].toFixed(1)} ${height - bottom} L ${coordinates[0][0].toFixed(1)} ${height - bottom} Z`;
    const guides = [0, 0.5, 1].map(fraction => {
      const y = top + fraction * (height - top - bottom);
      return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="var(--line)"/><text x="0" y="${y + 4}" fill="var(--mut)" font-size="10">${format(maximum - fraction * span)}</text>`;
    }).join('');

    const markers = coordinates.slice(-5).map((point, index) => {
      const data = points[points.length - Math.min(5, points.length) + index];
      const label = new Date(data.time * 1000).toLocaleString('es-ES');
      return `<circle cx="${point[0]}" cy="${point[1]}" r="3" fill="var(--surface)" stroke="var(--acc)" stroke-width="2"><title>${label}: ${format(data.value)}</title></circle>`;
    }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolución del capital virtual de ${format(minimum)} a ${format(maximum)}">${guides}<defs><linearGradient id="equityFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--acc)" stop-opacity=".2"/><stop offset="1" stop-color="var(--acc)" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#equityFill)"/><path d="${line}" fill="none" stroke="var(--acc)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${markers}</svg>`;
  },

  activityBars(points, format) {
    if (points.length < 2) {
      return '<div class="chart-empty">Se necesitan más registros de capital para mostrar la variación.</div>';
    }

    const recent = points.slice(-15);
    const changes = recent.slice(1).map((point, index) => ({
      time: point.time,
      value: point.value - recent[index].value
    }));
    const maxChange = Math.max(...changes.map(change => Math.abs(change.value)), 1e-9);
    const width = 720, height = 150, baseline = 74, maxBarHeight = 48;
    const step = (width - 32) / changes.length;
    const bars = changes.map((change, index) => {
      const barHeight = Math.max(Math.abs(change.value) / maxChange * maxBarHeight, 2);
      const x = 16 + index * step + step * 0.2;
      const y = change.value >= 0 ? baseline - barHeight : baseline;
      const color = change.value >= 0 ? 'url(#activityGain)' : 'url(#activityLoss)';
      const label = new Date(change.time * 1000).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(step * 0.6).toFixed(1)}" height="${barHeight.toFixed(1)}" rx="4" fill="${color}"><title>${label}: ${format(change.value)}</title></rect>`;
    }).join('');
    const labels = changes.filter((_, index) =>
      index === 0 || index === changes.length - 1 || index % Math.ceil(changes.length / 4) === 0
    ).map(change => {
      const x = 16 + changes.indexOf(change) * step + step / 2;
      return `<text x="${x.toFixed(1)}" y="140" text-anchor="middle" fill="var(--mut)" font-size="10">${new Date(change.time * 1000).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })}</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Barras de variación del capital virtual"><defs><linearGradient id="activityGain" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--acc)"/><stop offset="1" stop-color="var(--acc)" stop-opacity=".35"/></linearGradient><linearGradient id="activityLoss" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--no)"/><stop offset="1" stop-color="var(--no)" stop-opacity=".35"/></linearGradient></defs><line x1="12" y1="${baseline}" x2="${width - 12}" y2="${baseline}" stroke="var(--line)"/>${bars}${labels}</svg>`;
  }
};

function smoothPath(points) {
  if (points.length < 2) return '';
  let path = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index++) {
    const previous = points[Math.max(0, index - 1)];
    const start = points[index];
    const end = points[index + 1];
    const next = points[Math.min(points.length - 1, index + 2)];
    const firstControl = [
      start[0] + (end[0] - previous[0]) / 6,
      start[1] + (end[1] - previous[1]) / 6
    ];
    const secondControl = [
      end[0] - (next[0] - start[0]) / 6,
      end[1] - (next[1] - start[1]) / 6
    ];
    path += ` C${firstControl[0].toFixed(1)} ${firstControl[1].toFixed(1)},${secondControl[0].toFixed(1)} ${secondControl[1].toFixed(1)},${end[0].toFixed(1)} ${end[1].toFixed(1)}`;
  }
  return path;
}
