import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createRssNewsProvider, matchesQuery, createTtlCache, createCircuitBreaker,
} from '../server.js';
import { makeClock } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** 호스트별로 응답을 지정하는 가짜 http 클라이언트. */
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
  return createRssNewsProvider({
    http,
    cache: over.cache ?? createTtlCache({ ttlMs: 300_000, maxEntries: 50, clock }),
    clock,
    makeBreaker: () => createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, clock }),
  });
};

const allFeeds = {
  'news.google.com': fixture('google-news-ko.xml'),
  'yna.co.kr': fixture('yonhap-economy.xml'),
  'etnews.com': fixture('yonhap-economy.xml'),
};

// ─── 키워드 필터 ───

test('제목이나 본문에 검색어가 있으면 통과시킨다', () => {
  const item = { title: '삼성전자 실적 발표', content: '반도체 매출 증가' };
  assert.equal(matchesQuery(item, '삼성전자'), true);
  assert.equal(matchesQuery(item, '반도체'), true);
  assert.equal(matchesQuery(item, 'LG전자'), false);
});

test('검색어의 여러 낱말 중 하나만 맞아도 통과시킨다', () => {
  // "엔비디아 AI 반도체"로 검색했는데 셋 다 든 기사만 남기면 결과가 거의 없다.
  const item = { title: '엔비디아 신제품 공개', content: '데이터센터용' };
  assert.equal(matchesQuery(item, '엔비디아 AI 반도체'), true);
});

test('대소문자를 구분하지 않는다', () => {
  const item = { title: 'NVIDIA earnings', content: 'data center' };
  assert.equal(matchesQuery(item, 'nvidia'), true);
});

test('빈 검색어는 모두 통과시킨다', () => {
  assert.equal(matchesQuery({ title: 'a', content: 'b' }, ''), true);
});

// ─── 수집 ───

test('검색 피드와 주제 피드를 모두 수집해 합친다', async () => {
  const http = makeHttp(allFeeds);
  const res = await provider(http).search({ query: '경제', lang: 'ko', limit: 20 });

  assert.ok(res.items.length > 0);
  assert.ok(res.feedsUsed.includes('google-news-ko'));
  assert.ok(http.calls.some((u) => u.includes('news.google.com')));
  assert.ok(http.calls.some((u) => u.includes('yna.co.kr')));
});

test('검색 피드는 필터링하지 않는다', async () => {
  // 검색어를 URL에 넣었으므로 결과가 이미 검색 결과다.
  const http = makeHttp({ 'news.google.com': fixture('google-news-ko.xml') });
  const res = await provider(http).search({
    query: '절대일치하지않을검색어', lang: 'ko', limit: 20,
  });

  assert.ok(res.items.length > 0, '검색 피드 결과가 필터에 걸려 사라졌다');
});

test('주제 피드는 검색어로 거른다', async () => {
  const http = makeHttp({ 'yna.co.kr': fixture('yonhap-economy.xml') });
  const res = await provider(http).search({
    query: '절대일치하지않을검색어XYZ', lang: 'ko', limit: 20,
  });

  assert.equal(res.items.length, 0, '주제 피드가 필터링 없이 통과했다');
});

test('limit만큼만 반환한다', async () => {
  const http = makeHttp(allFeeds);
  const res = await provider(http).search({ query: '경제', lang: 'ko', limit: 3 });
  assert.ok(res.items.length <= 3);
});

test('반환 항목이 분석 스키마 필드를 모두 갖는다', async () => {
  const http = makeHttp(allFeeds);
  const res = await provider(http).search({ query: '경제', lang: 'ko', limit: 5 });

  for (const it of res.items) {
    for (const f of ['title', 'content', 'source', 'url', 'publishedAt', 'contentKind']) {
      assert.ok(it[f], `${f}가 없다`);
    }
  }
});

test('symbol이 있으면 티커 뉴스 피드도 부른다', async () => {
  const http = makeHttp({ ...allFeeds, 'feeds.finance.yahoo.com': fixture('google-news-ko.xml') });
  await provider(http).search({ query: '엔비디아', lang: 'ko', limit: 10, symbol: 'NVDA' });

  assert.ok(http.calls.some((u) => u.includes('feeds.finance.yahoo.com')));
  assert.ok(http.calls.some((u) => u.includes('NVDA')));
});

// ─── 부분 실패 ───

test('일부 피드가 실패해도 나머지로 진행한다', async () => {
  const http = makeHttp({
    'news.google.com': fixture('google-news-ko.xml'),
    'yna.co.kr': new Error('연합 다운'),
    'etnews.com': new Error('전자신문 다운'),
  });
  const res = await provider(http).search({ query: '경제', lang: 'ko', limit: 10 });

  assert.ok(res.items.length > 0, '살아있는 피드 결과까지 버렸다');
  assert.equal(res.degraded.length, 2);
  assert.ok(res.degraded.every((d) => d.feedId && d.reason));
});

test('모든 피드가 실패하면 빈 결과와 degraded를 반환한다', async () => {
  const http = makeHttp({
    'news.google.com': new Error('다운'),
    'yna.co.kr': new Error('다운'),
    'etnews.com': new Error('다운'),
  });
  const res = await provider(http).search({ query: '경제', lang: 'ko', limit: 10 });

  assert.equal(res.items.length, 0);
  assert.ok(res.degraded.length >= 3);
});

test('degraded 사유에 상류 원본 메시지를 담지 않는다', async () => {
  const http = makeHttp({
    'news.google.com': new Error('C:/secrets/key.pem 읽기 실패'),
    'yna.co.kr': fixture('yonhap-economy.xml'),
    'etnews.com': fixture('yonhap-economy.xml'),
  });
  const res = await provider(http).search({ query: '경제', lang: 'ko', limit: 10 });

  assert.equal(JSON.stringify(res.degraded).includes('secrets'), false);
});

test('깨진 XML을 주는 피드는 결과가 없을 뿐 예외를 던지지 않는다', async () => {
  const http = makeHttp({
    'news.google.com': '깨진 XML {{{',
    'yna.co.kr': fixture('yonhap-economy.xml'),
    'etnews.com': fixture('yonhap-economy.xml'),
  });
  const res = await provider(http).search({ query: '경제', lang: 'ko', limit: 10 });
  assert.ok(Array.isArray(res.items));
});

// ─── 캐시와 회로 차단기 ───

test('같은 검색을 두 번 하면 외부 호출이 한 번만 일어난다', async () => {
  const http = makeHttp(allFeeds);
  const p = provider(http);

  await p.search({ query: '경제', lang: 'ko', limit: 10 });
  const before = http.calls.length;
  await p.search({ query: '경제', lang: 'ko', limit: 10 });

  assert.equal(http.calls.length, before, '캐시가 있는데 다시 호출했다');
});

test('캐시 TTL이 지나면 다시 호출한다', async () => {
  const clock = makeClock();
  const http = makeHttp(allFeeds);
  const cache = createTtlCache({ ttlMs: 1000, maxEntries: 50, clock });
  const p = provider(http, { clock, cache });

  await p.search({ query: '경제', lang: 'ko', limit: 10 });
  const before = http.calls.length;
  clock.advance(1001);
  await p.search({ query: '경제', lang: 'ko', limit: 10 });

  assert.ok(http.calls.length > before);
});

test('검색어가 다르면 캐시를 공유하지 않는다', async () => {
  const http = makeHttp(allFeeds);
  const p = provider(http);

  await p.search({ query: '경제', lang: 'ko', limit: 10 });
  const before = http.calls.length;
  await p.search({ query: '반도체', lang: 'ko', limit: 10 });

  assert.ok(http.calls.length > before);
});

test('연속 실패한 피드는 회로가 열려 호출하지 않는다', async () => {
  const clock = makeClock();
  const http = makeHttp({
    'news.google.com': new Error('다운'),
    'yna.co.kr': fixture('yonhap-economy.xml'),
    'etnews.com': fixture('yonhap-economy.xml'),
  });
  // 캐시를 끄고(TTL 0) 매번 실제로 호출하게 한다.
  const p = provider(http, {
    clock,
    cache: createTtlCache({ ttlMs: 0, maxEntries: 50, clock }),
  });

  for (let i = 0; i < 3; i += 1) {
    await p.search({ query: `쿼리${i}`, lang: 'ko', limit: 10 });
  }
  const before = http.calls.filter((u) => u.includes('news.google.com')).length;

  await p.search({ query: '쿼리4', lang: 'ko', limit: 10 });
  const after = http.calls.filter((u) => u.includes('news.google.com')).length;

  assert.equal(after, before, '회로가 열렸는데 계속 호출했다');
});
