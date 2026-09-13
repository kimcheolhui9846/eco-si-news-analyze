import { computeIndicators, buildChartTrend } from './indicators.js';

export const RANGE_DAYS = { '5d': 5, '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365 };

const finiteClose = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function normalizePoints(points) {
  const map = new Map();
  for (const point of points ?? []) {
    const raw = point?.t instanceof Date ? null : String(point?.t ?? '');
    const date = point?.t instanceof Date ? point.t : new Date(point?.t ?? '');
    if (!Number.isFinite(date.getTime())) continue;
    const t = date.toISOString();
    if (raw && /^\d{4}-\d{2}-\d{2}/.test(raw) && t.slice(0, 10) !== raw.slice(0, 10)) continue;
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
      chartTrend: `${source === 'Coinbase' ? 'Coinbase 단일 거래소 USD 일봉 종가 기준. ' : source === 'Naver' ? 'Naver 일봉 종가 기준. ' : ''}${buildChartTrend(indicators, { currency, livePrice: price })}`.slice(0, 1000),
    },
  };
}

export function clockMs(clock) {
  return typeof clock === 'function' ? clock() : clock?.now?.() ?? Date.now();
}
