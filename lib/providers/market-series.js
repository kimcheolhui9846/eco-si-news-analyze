import { computeIndicators, buildChartTrend } from './indicators.js';

export const RANGE_DAYS = { '5d': 5, '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365 };

const finiteClose = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function normalizePoints(points) {
  const map = new Map();
  for (const point of points ?? []) {
    const t = point?.t instanceof Date ? point.t.toISOString() : new Date(point?.t ?? '').toISOString();
    const c = Number(point?.c);
    if (!Number.isFinite(new Date(t).getTime()) || !finiteClose(c)) continue;
    const v = point?.v == null ? null : Number(point.v);
    map.set(t, { t, c, v: Number.isFinite(v) && v >= 0 ? v : null });
  }
  return [...map.values()].sort((a, b) => a.t.localeCompare(b.t));
}

export function makeMarketResult({ symbol, currency, points, source, livePrice }) {
  const normalized = normalizePoints(points);
  const indicators = computeIndicators(normalized.map((p) => p.c), normalized.map((p) => p.v));
  if (!indicators) return null;
  const price = Number.isFinite(Number(livePrice)) && Number(livePrice) > 0 ? Number(livePrice) : indicators.last;
  return {
    indicators,
    series: { symbol, currency, points: normalized },
    marketData: {
      assetName: symbol,
      currentPrice: `${price.toLocaleString()} ${currency}`.trim(),
      priceChange: `${indicators.changePct.toFixed(2)}%`,
      chartTrend: `${source} ${buildChartTrend(indicators, { currency, livePrice: price })}`,
    },
  };
}

export function clockMs(clock) {
  return typeof clock === 'function' ? clock() : clock?.now?.() ?? Date.now();
}
