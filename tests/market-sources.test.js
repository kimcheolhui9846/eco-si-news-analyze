import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNaverMarket } from '../lib/providers/naver-market.js';
import { createCoinbaseMarket } from '../lib/providers/coinbase-market.js';
import { normalizePoints } from '../lib/providers/market-series.js';

const clock = { now: () => Date.parse('2026-09-14T14:00:00Z') };
const httpFor = (routes) => ({ calls: [], async get(url) { this.calls.push(url); const route = routes.find(([p]) => url.includes(p)); if (!route) throw new Error('missing route'); return { text: JSON.stringify(route[1]), status: 200, url }; } });
const meta = (extra = {}) => ({ reutersCode: 'NVDA.O', symbolCode: 'NVDA', currencyType: { code: 'USD' }, stockExchangeType: { name: 'NASDAQ', nationCode: 'USA' }, marketStatus: 'CLOSE', localTradedAt: '2026-09-11T16:00:00-04:00', closePrice: '218.29', ...extra });
const chart = [{ localDate: '20260910', closePrice: 217, accumulatedTradingVolume: 2 }, { localDate: '20260911', closePrice: 218.29, accumulatedTradingVolume: 3 }];

test('Naver stock route returns normalized series and excludes Yahoo', async () => {
  const http = httpFor([['/stock/NVDA.O/basic', meta()], ['/chart/foreign/item/NVDA.O/day', chart]]);
  const result = await createNaverMarket({ http, clock })('NVDA', '1mo');
  assert.equal(result.series.symbol, 'NVDA');
  assert.equal(result.series.currency, 'USD');
  assert.equal(result.series.points.length, result.indicators.points);
  assert.equal(http.calls.some((u) => u.includes('query1.finance.yahoo.com')), false);
});

test('Naver validates exchange identity and current-session close', async () => {
  const wrong = httpFor([['/stock/NVDA.O/basic', meta({ stockExchangeType: { name: 'NYSE', nationCode: 'USA' } })], ['/chart/foreign/item/NVDA.O/day', chart]]);
  assert.equal(await createNaverMarket({ http: wrong, clock })('NVDA', '1mo'), null);
});

test('normalization drops invalid zero dates and deduplicates points', () => {
  const result = normalizePoints([{ t: '2026-01-02T00:00:00Z', c: 2 }, { t: '2026-01-02T00:00:00Z', c: 3 }, { t: '2026-02-31T00:00:00Z', c: 4 }, { t: 'bad', c: 4 }, { t: '2026-01-03T00:00:00Z', c: 0 }]);
  assert.deepEqual(result.map((p) => p.c), [3]);
});

test('Coinbase splits one year into at most two requests and excludes today', async () => {
  const start = Math.floor(Date.parse('2025-09-14T00:00:00Z') / 1000);
  const end = Math.floor(Date.parse('2026-09-14T00:00:00Z') / 1000);
  const http = httpFor([['BTC-USD/candles', [[start, 1, 2, 1, 2, 3], [end - 86400, 1, 2, 1, 2, 3], [end, 1, 2, 1, 2, 3]]]]);
  const result = await createCoinbaseMarket({ http, clock })('bitcoin', '1y');
  assert.ok(http.calls.length <= 2);
  assert.ok(result.series.points.every((p) => p.t < '2026-09-14T00:00:00.000Z'));
});

test('Naver supports every documented US alias and preserves symbolCode identity', async () => {
  const aliases = ['NVDA', 'AAPL', 'MSFT', 'TSLA', 'GOOGL', 'AMZN', 'META', 'AMD', 'INTC', 'AVGO', 'TSM'];
  const http = { calls: [], async get(url) {
    this.calls.push(url);
    if (url.includes('/basic')) {
      const symbol = url.match(/stock\/([^/]+)\/basic/)?.[1]?.replace(/\.O$/, '') ?? 'NVDA';
      const isTsm = symbol === 'TSM';
      return { status: 200, text: JSON.stringify(meta({ reutersCode: isTsm ? 'TSM' : `${symbol}.O`, symbolCode: symbol, stockExchangeType: { name: isTsm ? 'NYSE' : 'NASDAQ', nationCode: 'USA' } })), url };
    }
    return { status: 200, text: JSON.stringify([{ localDate: '20260910', closePrice: 217, accumulatedTradingVolume: 2 }, { localDate: '20260911', closePrice: 218.29, accumulatedTradingVolume: 3 }]), url };
  } };
  for (const symbol of aliases) {
    const result = await createNaverMarket({ http, clock })(symbol, '1mo');
    assert.ok(result, symbol);
    assert.equal(result.series.symbol, symbol);
  }
  assert.ok(http.calls.every((url) => !url.includes('query1.finance.yahoo.com')));
});

test('Naver rejects foreign metadata with wrong nation or currency', async () => {
  const wrongNation = httpFor([['api.stock.naver.com', meta({ stockExchangeType: { name: 'NASDAQ', nationCode: 'KOR' } })]]);
  assert.equal(await createNaverMarket({ http: wrongNation, clock })('NVDA', '1mo'), null);
  const wrongCurrency = httpFor([['api.stock.naver.com', meta({ currencyType: { code: 'KRW' } })]]);
  assert.equal(await createNaverMarket({ http: wrongCurrency, clock })('NVDA', '1mo'), null);
});

test('Naver accepts a bare KQ domestic symbol and derives KRW from KS/KQ identity', async () => {
  const http = httpFor([
    ['/api/stock/035900/basic', { itemCode: '035900', stockExchangeType: { code: 'KQ', name: 'KOSDAQ', nationCode: 'KOR' }, marketStatus: 'CLOSE', localTradedAt: '2026-09-11T15:30:00+09:00', closePrice: '70,000' }],
    ['/chart/domestic/item/035900/day', [{ localDate: '20260910', closePrice: '69,000', accumulatedTradingVolume: 1 }, { localDate: '20260911', closePrice: '70,000', accumulatedTradingVolume: 2 }]],
  ]);
  const result = await createNaverMarket({ http, clock })('035900', '1mo');
  assert.equal(result.series.currency, 'KRW');
});

test('Naver CLOSE rejects a current-day candle that disagrees with metadata close', async () => {
  const http = httpFor([['/basic', meta({ localTradedAt: '2026-09-14T16:00:00-04:00', closePrice: '218.29' })], ['/chart/foreign/item/NVDA.O/day', [
    { localDate: '20260909', closePrice: 216, accumulatedTradingVolume: 1 },
    { localDate: '20260911', closePrice: 218.29, accumulatedTradingVolume: 2 },
    { localDate: '20260914', closePrice: 219, accumulatedTradingVolume: 3 },
  ]]]);
  const result = await createNaverMarket({ http, clock })('NVDA', '1mo');
  assert.deepEqual(result.series.points.map((point) => point.c), [216, 218.29]);
});

test('Naver 5d takes the latest five valid points after normalization', async () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ localDate: `2026090${i + 1}`, closePrice: i + 1, accumulatedTradingVolume: i }));
  rows.splice(2, 0, { localDate: '20260903', closePrice: 0, accumulatedTradingVolume: 1 });
  const http = httpFor([['/basic', meta()], ['/chart/foreign/item/NVDA.O/day', rows]]);
  const result = await createNaverMarket({ http, clock })('NVDA', '5d');
  assert.equal(result.series.points.length, 5);
  assert.deepEqual(result.series.points.map((p) => p.c), [4, 5, 6, 7, 8]);
});

test('Coinbase filters rows outside the requested half-open range and deduplicates chunk overlap', async () => {
  const start = Math.floor(Date.parse('2025-09-14T00:00:00Z') / 1000);
  const end = Math.floor(Date.parse('2026-09-14T00:00:00Z') / 1000);
  const day = 86400;
  const http = { calls: [], async get(url) {
    this.calls.push(url);
    const first = this.calls.length === 1;
    const rows = first
      ? [[start - day, 1, 2, 1, 2, 1], [start, 1, 2, 1, 3, 1], [start + 299 * day, 1, 2, 1, 4, 1]]
      : [[start + 298 * day, 1, 2, 1, 5, 1], [end - day, 1, 2, 1, 6, 1], [end, 1, 2, 1, 7, 1]];
    return { status: 200, text: JSON.stringify(rows), url };
  } };
  const result = await createCoinbaseMarket({ http, clock })('bitcoin', '1y');
  assert.equal(http.calls.length, 2);
  assert.equal(new Set(result.series.points.map((p) => p.t)).size, result.series.points.length);
  assert.deepEqual(result.series.points.map((p) => p.c), [3, 6]);
  assert.ok(result.series.points.every((p) => p.t >= '2025-09-14T00:00:00.000Z' && p.t < '2026-09-14T00:00:00.000Z'));
});

test('Coinbase malformed payload returns neutral no-data result', async () => {
  const http = httpFor([['BTC-USD/candles', { error: 'bad' }]]);
  assert.equal(await createCoinbaseMarket({ http, clock })('bitcoin', '1mo'), null);
});

test('Naver generic US symbols try the .O candidate then accept a matching bare candidate', async () => {
  const http = { calls: [], async get(url) {
    this.calls.push(url);
    if (url.endsWith('/IBM.O/basic')) return { status: 200, text: JSON.stringify({}), url };
    if (url.endsWith('/IBM/basic')) return { status: 200, text: JSON.stringify(meta({ reutersCode: 'IBM', symbolCode: 'IBM', stockExchangeType: { name: 'NYSE', nationCode: 'USA' } })), url };
    return { status: 200, text: JSON.stringify(chart), url };
  } };
  const result = await createNaverMarket({ http, clock })('IBM', '1mo');
  assert.ok(result);
  assert.ok(http.calls.some((url) => url.endsWith('/stock/IBM.O/basic')));
  assert.ok(http.calls.some((url) => url.endsWith('/stock/IBM/basic')));
});

test('Naver rejects an unmatched generic identity without requesting chart data', async () => {
  const http = httpFor([['api.stock.naver.com', meta({ reutersCode: 'OTHER.O', symbolCode: 'OTHER' })]]);
  assert.equal(typeof await createNaverMarket({ http, clock })('IBM', '1mo'), 'symbol');
  assert.equal(http.calls.some((url) => url.includes('/chart/')), false);
});

test('Coinbase maps all four supported crypto ids to explicit USD products', async () => {
  const expected = { bitcoin: 'BTC-USD', ethereum: 'ETH-USD', solana: 'SOL-USD', ripple: 'XRP-USD' };
  const http = { calls: [], async get(url) {
    this.calls.push(url);
    const day = Math.floor(Date.parse('2026-09-12T00:00:00Z') / 1000);
    return { status: 200, text: JSON.stringify([[day, 1, 2, 1, 2, 1], [day + 86400, 1, 2, 1, 3, 1]]), url };
  } };
  for (const [symbol, product] of Object.entries(expected)) {
    const result = await createCoinbaseMarket({ http, clock })(symbol, '1mo');
    assert.ok(result, symbol);
    assert.ok(http.calls.at(-1).includes(`/products/${product}/candles`));
  }
});

test('Naver OPEN metadata excludes the current local trading day while CLOSE matching includes it', async () => {
  const rows = [{ localDate: '20260910', closePrice: 217, accumulatedTradingVolume: 1 }, { localDate: '20260911', closePrice: 218, accumulatedTradingVolume: 2 }, { localDate: '20260914', closePrice: 219, accumulatedTradingVolume: 3 }];
  const open = httpFor([['/basic', meta({ marketStatus: 'OPEN', closePrice: '219', localTradedAt: '2026-09-14T10:00:00-04:00' })], ['/chart/foreign/item/NVDA.O/day', rows]]);
  const openResult = await createNaverMarket({ http: open, clock })('NVDA', '1mo');
  assert.deepEqual(openResult.series.points.map((point) => point.c), [217, 218]);
  const close = httpFor([['/basic', meta({ marketStatus: 'CLOSE', closePrice: '219', localTradedAt: '2026-09-14T16:00:00-04:00' })], ['/chart/foreign/item/NVDA.O/day', rows]]);
  const closeResult = await createNaverMarket({ http: close, clock: { now: () => Date.parse('2026-09-14T21:00:00Z') } })('NVDA', '1mo');
  assert.deepEqual(closeResult.series.points.map((point) => point.c), [217, 218, 219]);
});

test('Naver uses calendar month clamping and exchange-local dates for request bounds', async () => {
  const http = httpFor([['/basic', meta()], ['/chart/foreign/item/NVDA.O/day', chart]]);
  await createNaverMarket({ http, clock: { now: () => Date.parse('2026-01-31T18:00:00Z') } })('NVDA', '1mo');
  assert.ok(http.calls.some((url) => url.includes('startDateTime=202512310000')));
  const dstHttp = httpFor([['/basic', meta({ localTradedAt: '2026-03-09T16:00:00-04:00' })], ['/chart/foreign/item/NVDA.O/day', chart]]);
  await createNaverMarket({ http: dstHttp, clock: { now: () => Date.parse('2026-03-10T03:00:00Z') } })('NVDA', '1mo');
  assert.ok(dstHttp.calls.some((url) => url.includes('endDateTime=202603092359')));
});

test('Naver metadata cache is shared across ranges while chart requests remain range-specific', async () => {
  const cache = new Map();
  const http = httpFor([['/basic', meta()], ['/chart/foreign/item/NVDA.O/day', chart]]);
  const fetch = createNaverMarket({ http, clock, cache: { get: (key) => cache.get(key), set: (key, value) => cache.set(key, value) } });
  await fetch('NVDA', '1mo');
  await fetch('NVDA', '1y');
  assert.equal(http.calls.filter((url) => url.includes('/basic')).length, 1);
  assert.equal(http.calls.filter((url) => url.includes('/chart/')).length, 2);
});
