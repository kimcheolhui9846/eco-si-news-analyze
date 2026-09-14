import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createMarketProvider, lookupAlias, SYMBOL_ALIASES,
  createTtlCache, createCircuitBreaker,
} from '../server.js';
import { makeClock } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const makeHttp = (routes) => {
  const calls = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      for (const [pattern, handler] of Object.entries(routes)) {
        if (url.includes(pattern)) {
          if (handler instanceof Error) throw handler;
          return { status: 200, text: handler, url };
        }
      }
      throw new Error(`라우트 없음: ${url}`);
    },
  };
};

const provider = (http, over = {}) => {
  const clock = over.clock ?? makeClock();
  return createMarketProvider({
    http,
    cache: over.cache ?? createTtlCache({ ttlMs: 60_000, maxEntries: 50, clock }),
    clock,
    makeBreaker: over.makeBreaker ?? (() => createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, clock })),
  });
};

test('neutral market results neither reset nor open a failing source circuit', async () => {
  const outcomes = [new Error('down'), {}, new Error('down'), new Error('down')];
  let calls = 0;
  const http = { async get() {
    const outcome = outcomes[calls++];
    if (outcome instanceof Error) throw outcome;
    return { text: JSON.stringify(outcome) };
  } };
  const p = provider(http);
  for (let i = 0; i < 5; i += 1) assert.equal(await p.fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' }), null);
  assert.equal(calls, 4, 'the neutral response must not clear the first failure');
});

test('generic identity rejection or ambiguity permits legacy, transport failure does not', async () => {
  for (const mode of ['unmatched', 'ambiguous', 'transport']) {
    let legacyCalls = 0;
    const http = { async get(url) {
      if (url.includes('query1.finance.yahoo.com/v8')) {
        legacyCalls += 1;
        return { text: fixture('yahoo-chart-nvda.json') };
      }
      if (mode === 'transport') throw new Error('unreachable');
      if (mode === 'unmatched') return { text: '{}' };
      return { text: JSON.stringify({
        symbolCode: 'IBM', currencyType: { code: 'USD' },
        stockExchangeType: { name: url.includes('IBM.O') ? 'NASDAQ' : 'NYSE', nationCode: 'USA' },
      }) };
    } };
    const result = await provider(http).fetch({ symbol: 'IBM', assetType: 'stock', range: '1mo' });
    assert.equal(legacyCalls, mode === 'transport' ? 0 : 1, mode);
    assert.equal(Boolean(result), mode !== 'transport', mode);
  }
});

test('cached closing metadata caps later candles and expires with the supplied cache TTL', async () => {
  const clock = makeClock(Date.parse('2026-09-14T22:00:00Z'));
  let metadataCalls = 0;
  const http = { async get(url) {
    if (url.endsWith('/basic')) {
      metadataCalls += 1;
      return { text: JSON.stringify({
        symbolCode: 'NVDA', currencyType: { code: 'USD' },
        stockExchangeType: { name: 'NASDAQ', nationCode: 'USA' }, marketStatus: 'CLOSE',
        localTradedAt: metadataCalls === 1 ? '2026-09-11T16:00:00-04:00' : '2026-09-14T16:00:00-04:00',
        closePrice: metadataCalls === 1 ? '218' : '219',
      }) };
    }
    return { text: JSON.stringify([
      { localDate: '20260910', closePrice: 217 }, { localDate: '20260911', closePrice: 218 },
      { localDate: '20260914', closePrice: 219 },
    ]) };
  } };
  const p = provider(http, { clock });
  await p.fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  const cached = await p.fetch({ symbol: 'NVDA', assetType: 'stock', range: '1y' });
  assert.equal(metadataCalls, 1);
  assert.deepEqual(cached.series.points.map((point) => point.c), [217, 218]);
  clock.advance(60001);
  const refreshed = await p.fetch({ symbol: 'NVDA', assetType: 'stock', range: '1y' });
  assert.equal(metadataCalls, 2);
  assert.deepEqual(refreshed.series.points.map((point) => point.c), [217, 218, 219]);
});

const YAHOO = { 'query1.finance.yahoo.com/v8': fixture('yahoo-chart-nvda.json') };
const KOREA = { 'query1.finance.yahoo.com/v8': fixture('yahoo-chart-005930ks.json') };
const CRYPTO = { 'api.coingecko.com': fixture('coingecko-bitcoin.json') };
const NAVER_META = JSON.stringify({ reutersCode: 'NVDA.O', symbolCode: 'NVDA', currencyType: { code: 'USD' }, stockExchangeType: { name: 'NASDAQ', nationCode: 'USA' }, marketStatus: 'CLOSE', localTradedAt: '2026-09-11T16:00:00-04:00', closePrice: '218.29' });
const NAVER_CHART = JSON.stringify([{ localDate: '20260908', closePrice: 215, accumulatedTradingVolume: 1 }, { localDate: '20260909', closePrice: 216, accumulatedTradingVolume: 2 }, { localDate: '20260910', closePrice: 217, accumulatedTradingVolume: 3 }, { localDate: '20260911', closePrice: 218.29, accumulatedTradingVolume: 4 }]);
const NAVER = { 'api.stock.naver.com/stock/NVDA.O/basic': NAVER_META, 'api.stock.naver.com/chart/foreign/item/NVDA.O/day': NAVER_CHART };
const COINBASE = { 'api.exchange.coinbase.com/products/BTC-USD/candles': JSON.stringify([[1788739200, 100, 110, 105, 106, 1], [1788825600, 100, 110, 106, 108, 2], [1788912000, 100, 110, 108, 109, 3]]) };
const FIXED_CLOCK = makeClock(Date.parse('2026-09-14T14:00:00Z'));

// ─── 별칭 사전 ───

test('한글 회사명을 티커로 바꾼다', () => {
  assert.equal(lookupAlias('엔비디아').symbol, 'NVDA');
  assert.equal(lookupAlias('삼성전자').symbol, '005930.KS');
});

test('별칭 조회는 공백과 대소문자를 무시한다', () => {
  assert.equal(lookupAlias('  엔비디아  ').symbol, 'NVDA');
  assert.equal(lookupAlias('NVIDIA').symbol, 'NVDA');
  assert.equal(lookupAlias('nvidia').symbol, 'NVDA');
});

test('검색어에 회사명이 섞여 있어도 찾는다', () => {
  // 사용자는 "엔비디아 AI 반도체 실적"처럼 입력한다.
  assert.equal(lookupAlias('엔비디아 AI 반도체 실적').symbol, 'NVDA');
});

test('긴 이름이 짧은 이름보다 먼저 걸린다', () => {
  // "삼성바이오로직스"가 "삼성전자"와 겹치지 않아야 한다.
  assert.equal(lookupAlias('삼성바이오로직스 실적').symbol, '207940.KS');
});

test('코인 별칭은 assetType이 crypto다', () => {
  const btc = lookupAlias('비트코인');
  assert.equal(btc.symbol, 'bitcoin');
  assert.equal(btc.assetType, 'crypto');
});

test('모르는 이름은 null이다', () => {
  assert.equal(lookupAlias('존재하지않는회사명XYZ'), null);
});

test('사전의 모든 항목이 필수 필드를 갖는다', () => {
  for (const [key, v] of Object.entries(SYMBOL_ALIASES)) {
    assert.ok(v.symbol, `${key}: symbol 없음`);
    assert.ok(v.name, `${key}: name 없음`);
    assert.ok(['stock', 'crypto'].includes(v.assetType), `${key}: assetType 이상`);
  }
});

// ─── 심볼 해석 ───

test('symbol이 주어지면 그대로 쓴다', async () => {
  const r = await provider(makeHttp({})).resolveSymbol({ query: '아무거나', symbol: 'TSLA' });

  assert.equal(r.symbol, 'TSLA');
  assert.equal(r.source, 'explicit');
});

test('symbol이 없으면 별칭 사전을 본다', async () => {
  const r = await provider(makeHttp({})).resolveSymbol({ query: '엔비디아 실적' });

  assert.equal(r.symbol, 'NVDA');
  assert.equal(r.source, 'alias');
});

test('별칭에 없고 영문이면 Yahoo 검색을 시도한다', async () => {
  const http = makeHttp({
    'v1/finance/search': JSON.stringify({ quotes: [{ symbol: 'XYZQ', shortname: 'XYZQ Inc' }] }),
  });
  const r = await provider(http).resolveSymbol({ query: 'Some Unknown Corp' });

  assert.equal(r.symbol, 'XYZQ');
  assert.equal(r.source, 'search');
});

test('한글 질의는 Yahoo 검색을 시도하지 않는다', async () => {
  // Yahoo가 한글 질의에 400을 반환하는 것이 확인됐다. 부를 이유가 없다.
  const http = makeHttp({});
  const r = await provider(http).resolveSymbol({ query: '없는회사이름입니다' });

  assert.equal(r.source, 'unresolved');
  assert.equal(http.calls.length, 0, '한글인데 검색을 호출했다');
});

test('Yahoo 검색이 실패해도 예외를 던지지 않는다', async () => {
  const http = makeHttp({ 'v1/finance/search': new Error('다운') });
  const r = await provider(http).resolveSymbol({ query: 'Unknown Company' });

  assert.equal(r.source, 'unresolved');
  assert.equal(r.symbol, null);
});

// ─── 주식 시세 ───

test('Naver 응답에서 marketData를 만든다', async () => {
  const r = await provider(makeHttp(NAVER), { clock: FIXED_CLOCK }).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });

  assert.equal(r.marketData.assetName, 'NVDA');
  assert.ok(String(r.marketData.currentPrice).includes('218'));
  assert.ok(r.marketData.chartTrend.length > 20);
  assert.ok(r.marketData.priceChange.includes('%'));
});

test('통화 단위를 반영한다', async () => {
  const usd = await provider(makeHttp(NAVER), { clock: FIXED_CLOCK }).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  const krw = await provider(makeHttp({ 'm.stock.naver.com/api/stock/005930/basic': JSON.stringify({ itemCode: '005930', stockExchangeType: { code: 'KS', name: 'KOSPI', nationCode: 'KOR' }, marketStatus: 'CLOSE', localTradedAt: '2026-09-11T15:30:00+09:00', closePrice: '259,500' }), 'chart/domestic/item/005930/day': JSON.stringify([{ localDate: '20260910', closePrice: '258,000', accumulatedTradingVolume: 2 }, { localDate: '20260911', closePrice: '259,500', accumulatedTradingVolume: 3 }]) }), { clock: FIXED_CLOCK }).fetch({ symbol: '005930.KS', assetType: 'stock', range: '1mo' });

  assert.ok(String(usd.marketData.currentPrice).includes('USD'));
  assert.ok(String(krw.marketData.currentPrice).includes('KRW'));
});

test('지표를 함께 반환한다', async () => {
  const r = await provider(makeHttp(NAVER), { clock: FIXED_CLOCK }).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });

  assert.ok(r.indicators.points > 1);
  assert.equal(typeof r.indicators.changePct, 'number');
});

// ─── 코인 ───

test('Coinbase 응답에서 marketData를 만든다', async () => {
  const r = await provider(makeHttp(COINBASE), { clock: FIXED_CLOCK }).fetch({ symbol: 'bitcoin', assetType: 'crypto', range: '1mo' });

  assert.equal(r.marketData.assetName, 'bitcoin');
  assert.ok(r.marketData.chartTrend.length > 20);
  assert.ok(r.indicators.points > 1);
});

test('지원 코인은 Coinbase를, 주식은 Naver를 부른다', async () => {
  const stockHttp = makeHttp(NAVER);
  await provider(stockHttp, { clock: FIXED_CLOCK }).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  assert.ok(stockHttp.calls.every((u) => !u.includes('coingecko')));
  assert.ok(stockHttp.calls.every((u) => u.includes('naver')));

  const coinHttp = makeHttp(COINBASE);
  await provider(coinHttp, { clock: FIXED_CLOCK }).fetch({ symbol: 'bitcoin', assetType: 'crypto', range: '1mo' });
  assert.ok(coinHttp.calls.every((u) => u.includes('coinbase')));
});

// ─── 실패 처리 ───

test('상류가 죽으면 null을 반환하고 예외를 던지지 않는다', async () => {
  // 시장 데이터는 선택 사항이다. 없으면 뉴스만으로 진행해야 한다.
  const http = makeHttp({ 'api.stock.naver.com': new Error('down') });
  const r = await provider(http, { clock: FIXED_CLOCK }).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });

  assert.equal(r, null);
});

test('응답이 깨져 있으면 null을 반환한다', async () => {
  const http = makeHttp({ 'api.stock.naver.com': '{"chart":{"result":null}}' });
  const r = await provider(http, { clock: FIXED_CLOCK }).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });

  assert.equal(r, null);
});

test('가격 포인트가 부족하면 null을 반환한다', async () => {
  const thin = JSON.stringify({
    chart: { result: [{
      meta: { symbol: 'X', currency: 'USD', regularMarketPrice: 1 },
      timestamp: [1],
      indicators: { quote: [{ close: [1], volume: [1] }] },
    }] },
  });
  const http = makeHttp({ 'query1.finance.yahoo.com/v8': thin });
  const r = await provider(http).fetch({ symbol: 'X', assetType: 'stock', range: '1mo' });

  assert.equal(r, null);
});

test('심볼이 없으면 호출하지 않고 null을 반환한다', async () => {
  const http = makeHttp(YAHOO);
  const r = await provider(http).fetch({ symbol: null, assetType: 'stock', range: '1mo' });

  assert.equal(r, null);
  assert.equal(http.calls.length, 0);
});

// ─── 캐시와 회로 차단기 ───

test('같은 심볼을 두 번 조회하면 외부 호출이 한 번만 일어난다', async () => {
  const http = makeHttp(NAVER);
  const p = provider(http, { clock: FIXED_CLOCK });

  await p.fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  const before = http.calls.length;
  await p.fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });

  assert.equal(http.calls.length, before);
});

test('range가 다르면 캐시를 공유하지 않는다', async () => {
  const http = makeHttp(YAHOO);
  const p = provider(http, { clock: FIXED_CLOCK });

  await p.fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  const before = http.calls.length;
  await p.fetch({ symbol: 'NVDA', assetType: 'stock', range: '3mo' });

  assert.ok(http.calls.length > before);
});

test('연속 실패 후 회로가 열리면 호출하지 않는다', async () => {
  const clock = makeClock();
  const http = makeHttp({ 'query1.finance.yahoo.com': new Error('다운') });
  const p = provider(http, { clock, cache: createTtlCache({ ttlMs: 0, maxEntries: 10, clock }) });

  for (let i = 0; i < 3; i += 1) {
    await p.fetch({ symbol: `SYM${i}`, assetType: 'stock', range: '1mo' });
  }
  const before = http.calls.length;

  await p.fetch({ symbol: 'SYM9', assetType: 'stock', range: '1mo' });
  assert.equal(http.calls.length, before, '회로가 열렸는데 계속 호출했다');
});

// ─── 가격 시계열 (Phase 3) ───

test('주식 조회가 시계열을 함께 반환한다', async () => {
  const r = await provider(makeHttp(NAVER), { clock: FIXED_CLOCK }).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });

  assert.ok(r.series, 'series가 없다');
  assert.equal(r.series.symbol, 'NVDA');
  assert.equal(r.series.currency, 'USD');
  assert.ok(r.series.points.length > 1);
});

test('supported source breaker opens after three failures while legacy breaker remains isolated', async () => {
  const breakers = [];
  const makeBreaker = () => { const state = { failures: 0, calls: 0 }; breakers.push(state); return { canPass: () => { state.calls += 1; return state.failures < 3; }, recordFailure: () => { state.failures += 1; }, recordSuccess: () => {} }; };
  const http = makeHttp({ 'api.stock.naver.com': new Error('down'), 'query1.finance.yahoo.com/v8': fixture('yahoo-chart-nvda.json') });
  const p = provider(http, { clock: FIXED_CLOCK, makeBreaker, cache: createTtlCache({ ttlMs: 0, maxEntries: 10, clock: FIXED_CLOCK }) });
  for (let i = 0; i < 4; i += 1) await p.fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  await p.fetch({ symbol: 'BRK-B', assetType: 'stock', range: '1mo' });
  assert.equal(http.calls.filter((url) => url.includes('api.stock.naver.com')).length, 3);
  assert.ok(http.calls.some((url) => url.includes('query1.finance.yahoo.com/v8')));
  assert.ok(breakers.length >= 2);
});

test('시계열 각 점이 시각과 종가를 갖는다', async () => {
  const r = await provider(makeHttp(NAVER), { clock: FIXED_CLOCK }).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  const p = r.series.points[0];

  assert.match(p.t, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof p.c, 'number');
  assert.ok(Number.isFinite(p.c));
});

test('시계열 점 수가 지표의 점 수와 같다', async () => {
  // 둘이 다르면 차트와 이동평균이 어긋난다.
  const r = await provider(makeHttp(NAVER), { clock: FIXED_CLOCK }).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  assert.equal(r.series.points.length, r.indicators.points);
});

test('종가가 null인 지점은 시계열에서 빠진다', async () => {
  const withGaps = JSON.stringify({
    chart: { result: [{
      meta: { symbol: 'BRK-B', currency: 'USD', regularMarketPrice: 110 },
      timestamp: [1756000000, 1756086400, 1756172800],
      indicators: { quote: [{ close: [100, null, 110], volume: [10, null, 20] }] },
    }] },
  });
  const r = await provider(makeHttp({ 'query1.finance.yahoo.com/v8': withGaps }))
    .fetch({ symbol: 'BRK-B', assetType: 'stock', range: '1mo' });

  assert.equal(r.series.points.length, 2);
  assert.deepEqual(r.series.points.map((p) => p.c), [100, 110]);
});

test('코인 조회도 시계열을 반환한다', async () => {
  const r = await provider(makeHttp(COINBASE), { clock: FIXED_CLOCK }).fetch({ symbol: 'bitcoin', assetType: 'crypto', range: '1mo' });

  assert.equal(r.series.symbol, 'bitcoin');
  assert.equal(r.series.currency, 'USD');
  assert.ok(r.series.points.length > 1);
});
