import { makeMarketResult, clockMs } from './market-series.js';

const FOREIGN = new Set(['NVDA', 'AAPL', 'MSFT', 'TSLA', 'GOOGL', 'AMZN', 'META', 'AMD', 'INTC', 'AVGO']);
const EXCHANGE = { NVDA: 'NASDAQ', AAPL: 'NASDAQ', MSFT: 'NASDAQ', TSLA: 'NASDAQ', GOOGL: 'NASDAQ', AMZN: 'NASDAQ', META: 'NASDAQ', AMD: 'NASDAQ', INTC: 'NASDAQ', AVGO: 'NASDAQ', TSM: 'NYSE' };
const domestic = (symbol) => /^\d{6}(?:\.(KS|KQ))?$/i.test(symbol) ? symbol.slice(0, 6) : null;
const candidates = (symbol) => {
  if (FOREIGN.has(symbol)) return [`${symbol}.O`, symbol];
  if (/^[A-Z]{1,5}$/.test(symbol) && symbol !== 'TSM') return [`${symbol}.O`, symbol];
  return [symbol];
};

const parseJson = (text) => JSON.parse(text);
const rowsFrom = (body) => Array.isArray(body) ? body : body?.datas ?? body?.data ?? body?.result ?? body?.results ?? [];
const metadata = (body) => Array.isArray(body) ? body[0] : body?.datas?.[0] ?? body?.data ?? body?.result?.[0] ?? body;
const field = (obj, ...names) => names.map((n) => obj?.[n]).find((v) => v !== undefined);

function validMetadata(meta, symbol, domesticCode) {
  if (!meta || typeof meta !== 'object') return null;
  const code = String(field(meta, 'symbolCode', 'reutersCode', 'itemCode', 'code') ?? '').toUpperCase();
  const currency = domesticCode
    ? (/^(KS|KQ)$/.test(String(field(meta, 'stockExchangeType')?.code ?? '').toUpperCase()) ? 'KRW' : '')
    : String(field(meta, 'currencyType', 'currency')?.code ?? field(meta, 'currency') ?? '').toUpperCase();
  const market = String(field(meta, 'stockExchangeType')?.name ?? field(meta, 'market') ?? '').toUpperCase();
  const expected = domesticCode ? domesticCode : candidates(symbol).map((x) => x.toUpperCase());
  if (domesticCode && code && !code.includes(domesticCode)) return null;
  if (!domesticCode && code && code !== symbol && !expected.includes(code)) return null;
  if (!['USD', 'KRW'].includes(currency)) return null;
  if (domesticCode && !/KOSPI|KOSDAQ|KOREA/.test(market)) return null;
  if (!domesticCode && EXCHANGE[symbol] && market !== EXCHANGE[symbol]) return null;
  const nation = String(field(meta, 'stockExchangeType')?.nationCode ?? '').toUpperCase();
  if (!domesticCode && nation && nation !== 'USA') return null;
  if (domesticCode && nation && nation !== 'KOR') return null;
  if (domesticCode) {
    const expectedMarket = String(symbol).toUpperCase().endsWith('.KQ') ? 'KQ' : 'KS';
    const exchangeCode = String(field(meta, 'stockExchangeType')?.code ?? '').toUpperCase();
    if (exchangeCode !== expectedMarket) return null;
  }
  return { currency, close: Number(String(field(meta, 'closePrice', 'regularMarketPrice', 'close') ?? '').replaceAll(',', '')), status: String(meta.marketStatus ?? '').toUpperCase(), tradedAt: meta.localTradedAt };
}

const dateParts = (ms, zone) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
const dateString = (p) => `${p.year}-${p.month}-${p.day}`;
const shift = (s, days) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

export function createNaverMarket({ http, clock }) {
  return async function fetchNaver(symbol, range) {
    const domesticCode = domestic(symbol);
    let code = domesticCode ?? candidates(symbol)[0];
    let meta = null;
    for (const candidate of domesticCode ? [code] : candidates(symbol)) {
      const metaUrl = domesticCode
        ? `https://m.stock.naver.com/api/stock/${encodeURIComponent(candidate)}/basic`
        : `https://api.stock.naver.com/stock/${encodeURIComponent(candidate)}/basic`;
      try { meta = validMetadata(metadata(parseJson((await http.get(metaUrl)).text)), symbol, domesticCode); } catch { meta = null; }
      if (meta) { code = candidate; break; }
    }
    if (!meta) return null;
    const zone = domesticCode ? 'Asia/Seoul' : 'America/New_York';
    const nowMs = clockMs(clock);
    const end = dateString(dateParts(nowMs, zone));
    let start;
    if (range === '5d') start = shift(end, -45);
    else { const [y, m, day] = end.split('-').map(Number); const months = ({ '1mo': 1, '3mo': 3, '6mo': 6, '1y': 12 }[range] ?? 1); const target = new Date(Date.UTC(y, m - 1 - months, 1)); const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate(); target.setUTCDate(Math.min(day, last)); start = target.toISOString().slice(0, 10); }
    const kind = domesticCode ? 'domestic' : 'foreign';
    const url = `https://api.stock.naver.com/chart/${kind}/item/${encodeURIComponent(code)}/day?startDateTime=${start.replaceAll('-', '')}0000&endDateTime=${end.replaceAll('-', '')}2359`;
    const rows = rowsFrom(parseJson((await http.get(url)).text));
    const points = rows.map((row) => {
      const ds = String(field(row, 'localDate', 'date', 'time') ?? '').replaceAll('-', '').slice(0, 8);
      if (!/^\d{8}$/.test(ds)) return null;
      const parsed = new Date(`${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6)}T00:00:00Z`);
      if (parsed.toISOString().slice(0, 10).replaceAll('-', '') !== ds) return null;
      return { t: `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6)}T00:00:00.000Z`, c: Number(String(field(row, 'closePrice', 'close') ?? '').replaceAll(',', '')), v: field(row, 'accumulatedTradingVolume', 'volume') };
    }).filter(Boolean).filter((p) => p.t.slice(0, 10) <= end);
    const today = end;
    const completed = meta.status === 'OPEN' ? points.filter((p) => p.t.slice(0, 10) < today) : points;
    if (meta.tradedAt && Date.parse(meta.tradedAt) > nowMs) return null;
    if (meta.status === 'CLOSE' && Number.isFinite(meta.close) && completed.length && completed.at(-1).c !== meta.close) return null;
    const selected = range === '5d' ? completed.filter((p) => p.t.slice(0, 10) >= start && p.t.slice(0, 10) <= end).slice(-5) : completed.filter((p) => p.t.slice(0, 10) >= start && p.t.slice(0, 10) <= end);
    return makeMarketResult({ symbol, currency: meta.currency, points: selected, source: 'Naver' });
  };
}
