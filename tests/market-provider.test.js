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
    makeBreaker: () => createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, clock }),
  });
};

const YAHOO = { 'query1.finance.yahoo.com/v8': fixture('yahoo-chart-nvda.json') };
const KOREA = { 'query1.finance.yahoo.com/v8': fixture('yahoo-chart-005930ks.json') };
const CRYPTO = { 'api.coingecko.com': fixture('coingecko-bitcoin.json') };

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

test('Yahoo 응답에서 marketData를 만든다', async () => {
  const r = await provider(makeHttp(YAHOO)).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });

  assert.equal(r.marketData.assetName, 'NVDA');
  assert.ok(String(r.marketData.currentPrice).includes('217'));
  assert.ok(r.marketData.chartTrend.length > 20);
  assert.ok(r.marketData.priceChange.includes('%'));
});

test('통화 단위를 반영한다', async () => {
  const usd = await provider(makeHttp(YAHOO)).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  const krw = await provider(makeHttp(KOREA)).fetch({ symbol: '005930.KS', assetType: 'stock', range: '1mo' });

  assert.ok(String(usd.marketData.currentPrice).includes('USD'));
  assert.ok(String(krw.marketData.currentPrice).includes('KRW'));
});

test('지표를 함께 반환한다', async () => {
  const r = await provider(makeHttp(YAHOO)).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });

  assert.ok(r.indicators.points > 1);
  assert.equal(typeof r.indicators.changePct, 'number');
});

// ─── 코인 ───

test('CoinGecko 응답에서 marketData를 만든다', async () => {
  const r = await provider(makeHttp(CRYPTO)).fetch({ symbol: 'bitcoin', assetType: 'crypto', range: '1mo' });

  assert.equal(r.marketData.assetName, 'bitcoin');
  assert.ok(r.marketData.chartTrend.length > 20);
  assert.ok(r.indicators.points > 1);
});

test('코인은 CoinGecko를, 주식은 Yahoo를 부른다', async () => {
  const stockHttp = makeHttp(YAHOO);
  await provider(stockHttp).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  assert.ok(stockHttp.calls.every((u) => !u.includes('coingecko')));

  const coinHttp = makeHttp(CRYPTO);
  await provider(coinHttp).fetch({ symbol: 'bitcoin', assetType: 'crypto', range: '1mo' });
  assert.ok(coinHttp.calls.every((u) => u.includes('coingecko')));
});

// ─── 실패 처리 ───

test('상류가 죽으면 null을 반환하고 예외를 던지지 않는다', async () => {
  // 시장 데이터는 선택 사항이다. 없으면 뉴스만으로 진행해야 한다.
  const http = makeHttp({ 'query1.finance.yahoo.com': new Error('다운') });
  const r = await provider(http).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });

  assert.equal(r, null);
});

test('응답이 깨져 있으면 null을 반환한다', async () => {
  const http = makeHttp({ 'query1.finance.yahoo.com/v8': '{"chart":{"result":null}}' });
  const r = await provider(http).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });

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
  const http = makeHttp(YAHOO);
  const p = provider(http);

  await p.fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  const before = http.calls.length;
  await p.fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });

  assert.equal(http.calls.length, before);
});

test('range가 다르면 캐시를 공유하지 않는다', async () => {
  const http = makeHttp(YAHOO);
  const p = provider(http);

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
