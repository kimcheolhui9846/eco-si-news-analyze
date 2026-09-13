import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNaverMarket } from '../lib/providers/naver-market.js';
import { createCoinbaseMarket } from '../lib/providers/coinbase-market.js';
import { normalizePoints } from '../lib/providers/market-series.js';

const clock = { now: () => Date.parse('2026-09-14T14:00:00Z') };
const httpFor = (routes) => ({ calls: [], async get(url) { this.calls.push(url); const route = routes.find(([p]) => url.includes(p)); if (!route) throw new Error('missing route'); return { text: JSON.stringify(route[1]), status: 200, url }; } });
const meta = (extra = {}) => ({ reutersCode: 'NVDA.O', symbolCode: 'NVDA.O', currencyType: { code: 'USD' }, stockExchangeType: { name: 'NASDAQ', nationCode: 'USA' }, marketStatus: 'CLOSE', localTradedAt: '2026-09-11T16:00:00-04:00', closePrice: '218.29', ...extra });
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
