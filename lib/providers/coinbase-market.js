import { RANGE_DAYS, makeMarketResult, clockMs } from './market-series.js';

const PRODUCTS = { bitcoin: 'BTC-USD', ethereum: 'ETH-USD', solana: 'SOL-USD', ripple: 'XRP-USD' };
const iso = (ms) => new Date(ms).toISOString();
export function createCoinbaseMarket({ http, clock }) {
  return async function fetchCoinbase(symbol, range) {
    const product = PRODUCTS[symbol];
    if (!product) return null;
    const now = new Date(clockMs(clock));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const days = RANGE_DAYS[range] ?? 30;
    const start = new Date(end.getTime() - days * 86400000);
    const chunks = [];
    let cursor = start;
    while (cursor < end) {
      const chunkEnd = new Date(Math.min(cursor.getTime() + 299 * 86400000, end.getTime()));
      const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=86400&start=${encodeURIComponent(iso(cursor))}&end=${encodeURIComponent(iso(chunkEnd))}`;
      const body = JSON.parse((await http.get(url)).text);
      if (!Array.isArray(body)) return null;
      chunks.push(...body);
      cursor = chunkEnd;
      if (cursor >= end) break;
    }
    const points = chunks.map((row) => {
      const stamp = Number(row?.[0]);
      if (!Number.isFinite(stamp)) return null;
      const date = new Date(stamp * 1000);
      if (!Number.isFinite(date.getTime())) return null;
      return { t: date.toISOString(), c: Number(row?.[4]), v: row?.[5] == null ? null : Number(row[5]) };
    }).filter((p) => p && p.t >= start.toISOString() && p.t < end.toISOString());
    return makeMarketResult({ symbol, currency: 'USD', points, source: 'Coinbase' });
  };
}
