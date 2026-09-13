import { makeMarketResult, clockMs } from './market-series.js';

const FOREIGN = new Set(['NVDA', 'AAPL', 'MSFT', 'TSLA', 'GOOGL', 'AMZN', 'META', 'AMD', 'INTC', 'AVGO']);
const domestic = (symbol) => /^\d{6}\.(KS|KQ)$/i.test(symbol) ? symbol.slice(0, 6) : null;
const candidates = (symbol) => FOREIGN.has(symbol) ? [`${symbol}.O`, symbol] : [symbol];

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
  if (!domesticCode && code && !expected.includes(code)) return null;
  if (!['USD', 'KRW'].includes(currency)) return null;
  if (domesticCode && !/KOSPI|KOSDAQ|KOREA/.test(market) && meta.stockExchangeType) return null;
  return { currency, close: Number(String(field(meta, 'closePrice', 'regularMarketPrice', 'close') ?? '').replaceAll(',', '')) };
}

const dateParts = (ms, zone) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
const dateString = (p) => `${p.year}-${p.month}-${p.day}`;
const shift = (s, days) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

export function createNaverMarket({ http, clock }) {
  return async function fetchNaver(symbol, range) {
    const domesticCode = domestic(symbol);
    const code = domesticCode ?? candidates(symbol)[0];
    const metaUrl = domesticCode
      ? `https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/basic`
      : `https://api.stock.naver.com/stock/${encodeURIComponent(code)}/basic`;
    const meta = validMetadata(metadata(parseJson((await http.get(metaUrl)).text)), symbol, domesticCode);
    if (!meta) return null;
    const zone = domesticCode ? 'Asia/Seoul' : 'America/New_York';
    const end = dateString(dateParts(clockMs(clock), zone));
    let start;
    if (range === '5d') start = shift(end, -45);
    else { const d = new Date(`${end}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - ({ '1mo': 1, '3mo': 3, '6mo': 6, '1y': 12 }[range] ?? 1)); start = d.toISOString().slice(0, 10); }
    const kind = domesticCode ? 'domestic' : 'foreign';
    const url = `https://api.stock.naver.com/chart/${kind}/item/${encodeURIComponent(code)}/day?startDateTime=${start.replaceAll('-', '')}0000&endDateTime=${end.replaceAll('-', '')}2359`;
    const rows = rowsFrom(parseJson((await http.get(url)).text));
    const points = rows.map((row) => {
      const ds = String(field(row, 'localDate', 'date', 'time') ?? '').replaceAll('-', '').slice(0, 8);
      if (!/^\d{8}$/.test(ds)) return null;
      return { t: `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6)}T00:00:00.000Z`, c: Number(String(field(row, 'closePrice', 'close') ?? '').replaceAll(',', '')), v: field(row, 'accumulatedTradingVolume', 'volume') };
    }).filter(Boolean).filter((p) => p.t.slice(0, 10) <= end);
    const selected = range === '5d' ? points.slice(-5) : points.filter((p) => p.t.slice(0, 10) >= start);
    return makeMarketResult({ symbol, currency: meta.currency, points: selected, source: 'Naver', livePrice: meta.close });
  };
}
