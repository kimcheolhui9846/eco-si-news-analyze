import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTtlCache, createCircuitBreaker, loadConfig } from '../server.js';
import { buildHnUrl, parseHnSearch, createHackerNewsProvider } from '../lib/providers/hackernews.js';
import {
  buildGithubUrl, parseGithubSearch, createGithubProvider, GITHUB_LIMIT_REASON,
} from '../lib/providers/github.js';
import {
  buildSoUrl, parseSoSearch, createStackOverflowProvider, SO_LIMIT_REASON,
} from '../lib/providers/stackoverflow.js';
import { cleanText, httpUrlOrNull, CS_LIMITS, CS_MAX } from '../lib/providers/cs-common.js';
import { makeClock } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** responder(url)가 문자열이면 본문, Error면 던진다. 호출과 옵션을 기록한다. */
const makeHttp = (responder) => {
  const calls = [];
  return {
    calls,
    async get(url, opts) {
      calls.push({ url, opts });
      const r = responder(url);
      if (r instanceof Error) throw r;
      return { status: 200, text: r, url };
    },
  };
};
const deps = (http, clock = makeClock()) => ({
  http,
  clock,
  cache: createTtlCache({ ttlMs: 21_600_000, maxEntries: 100, clock }),
  makeBreaker: () => createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, clock }),
});
const upstream = (status) => Object.assign(new Error('upstream'), { upstreamStatus: status });

// ─── 공용 ───

test('cleanText는 제어문자·태그·엔티티를 걷고 공백을 합친다', () => {
  assert.equal(cleanText('<b>a</b>&amp;\u0007b'), 'a &b');
  assert.equal(cleanText(null), '');
});

test('httpUrlOrNull은 http(s)만 통과시킨다', () => {
  assert.equal(httpUrlOrNull('https://a.com/x'), 'https://a.com/x');
  assert.equal(httpUrlOrNull('javascript:alert(1)'), null);
  assert.equal(httpUrlOrNull(`https://a.com/${'x'.repeat(2100)}`), null);
  assert.equal(httpUrlOrNull(undefined), null);
});

test('기본 허용 목록에 HN·GitHub가 있고 CS 설정 기본값이 있다', () => {
  const config = loadConfig({
    MY_SECRET_PASSWORD: 'x', LLM_MODE: 'mock',
    EXTERNAL_ALLOWLIST: undefined, GITHUB_TOKEN: undefined, CS_CACHE_TTL_MS: undefined,
  });
  for (const host of ['hn.algolia.com', 'api.github.com', 'toss.tech', 'developer.nvidia.com']) {
    assert.ok(config.externalAllowlist.includes(host), host);
  }
  assert.equal(config.githubToken, '');
  assert.equal(config.csCacheTtlMs, 21_600_000);
});

// ─── Hacker News ───

test('HN 검색 URL: story·기간·상한', () => {
  assert.equal(
    buildHnUrl({ query: 'rag agents', sinceEpochSec: 1_697_408_000, limit: 10 }),
    'https://hn.algolia.com/api/v1/search?query=rag+agents&tags=story&numericFilters=created_at_i%3E1697408000&hitsPerPage=10',
  );
});

test('HN 응답 파싱', () => {
  const items = parseHnSearch(fixture('hn-search.json'));
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: 'Show HN: A tiny RAG server in 300 lines',
    url: 'https://github.com/example/tiny-rag',
    discussionUrl: 'https://news.ycombinator.com/item?id=45810001',
    points: 312,
    numComments: 87,
    publishedAt: '2026-11-05T08:00:00.000Z',
    text: '',
  });
  // 링크가 없는 글은 토론 페이지를 링크로 쓴다.
  assert.equal(items[1].url, 'https://news.ycombinator.com/item?id=45810002');
  assert.equal(items[1].text, "Has anyone 'tried' RAG & long context?");
});

test('HN 파서는 깨진 JSON에 빈 배열', () => {
  assert.deepEqual(parseHnSearch('{'), []);
});

test('HN 본문은 상한까지 자른다', () => {
  const long = JSON.stringify({ hits: [{
    objectID: '1', title: 't', url: null, points: 1, num_comments: 0,
    created_at: '2026-11-01T00:00:00Z', story_text: 'a'.repeat(3000),
  }] });
  assert.equal(parseHnSearch(long)[0].text.length, CS_LIMITS.text);
});

test('HN provider: 30일 전 기준으로 부르고 결과를 캐시한다', async () => {
  const http = makeHttp(() => fixture('hn-search.json'));
  const hn = createHackerNewsProvider(deps(http));

  const first = await hn.search({ query: 'rag', limit: 10 });
  const second = await hn.search({ query: 'rag', limit: 10 });

  assert.equal(first.items.length, 2);
  assert.deepEqual(first.degraded, []);
  assert.deepEqual(second.items, first.items);
  assert.equal(http.calls.length, 1);
  // makeClock 기본 시각 1_700_000_000_000ms → 30일 전 1_697_408_000초
  assert.ok(http.calls[0].url.includes('created_at_i%3E1697408000'));
});

test('HN provider: 실패는 degraded로 남기고 캐시하지 않는다', async () => {
  const http = makeHttp(() => new Error('down'));
  const hn = createHackerNewsProvider(deps(http));

  const r = await hn.search({ query: 'rag', limit: 10 });
  assert.deepEqual(r, { items: [], degraded: [{ source: 'Hacker News', reason: '자료를 가져오지 못했습니다.' }] });

  await hn.search({ query: 'rag', limit: 10 });
  assert.equal(http.calls.length, 2);
});

// ─── GitHub ───

test('GitHub 검색 URL', () => {
  assert.equal(
    buildGithubUrl({ query: 'rag', since: '2023-10-15', limit: 8 }),
    'https://api.github.com/search/repositories?q=rag+pushed%3A%3E2023-10-15&sort=stars&order=desc&per_page=8',
  );
});

test('GitHub 응답 파싱: github.com이 아닌 링크는 버린다', () => {
  const items = parseGithubSearch(fixture('github-search.json'));
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    fullName: 'example/tiny-rag',
    url: 'https://github.com/example/tiny-rag',
    description: 'A tiny RAG server in 300 lines',
    stars: 1520,
    language: 'Python',
    license: 'MIT',
    pushedAt: '2026-11-06T00:00:00.000Z',
    createdAt: '2026-10-20T00:00:00.000Z',
  });
  assert.deepEqual(items[1], {
    fullName: 'lab/rag-bench',
    url: 'https://github.com/lab/rag-bench',
    description: '',
    stars: 230,
    language: null,
    license: null,
    pushedAt: '2026-11-01T12:00:00.000Z',
    createdAt: '2025-03-01T00:00:00.000Z',
  });
});

test('GitHub provider: 헤더·기간·토큰', async () => {
  const http = makeHttp(() => fixture('github-search.json'));
  await createGithubProvider({ ...deps(http), token: '' }).search({ query: 'rag', limit: 8 });
  assert.deepEqual(http.calls[0].opts.headers, {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'eco-si-news-analyze',
  });
  assert.ok(http.calls[0].url.includes('pushed%3A%3E2023-10-15'));

  const http2 = makeHttp(() => fixture('github-search.json'));
  await createGithubProvider({ ...deps(http2), token: 'tok' }).search({ query: 'rag', limit: 8 });
  assert.equal(http2.calls[0].opts.headers.Authorization, 'Bearer tok');
});

test('GitHub provider: 403·429는 한도 사유, 그 밖은 일반 사유', async () => {
  for (const status of [403, 429]) {
    const http = makeHttp(() => upstream(status));
    const r = await createGithubProvider({ ...deps(http), token: '' }).search({ query: 'rag', limit: 8 });
    assert.deepEqual(r.degraded, [{ source: 'GitHub', reason: GITHUB_LIMIT_REASON }]);
  }
  const http = makeHttp(() => upstream(500));
  const r = await createGithubProvider({ ...deps(http), token: '' }).search({ query: 'rag', limit: 8 });
  assert.deepEqual(r.degraded, [{ source: 'GitHub', reason: '자료를 가져오지 못했습니다.' }]);
  assert.equal(GITHUB_LIMIT_REASON, 'GitHub 검색 한도를 넘었습니다.');
});

// ─── 형식이 틀린 200 응답은 실패다 ───

const HTML_200 = '<!doctype html><html><body>Just a moment...</body></html>';
const FETCH_FAILED_REASON = '자료를 가져오지 못했습니다.';

test('HN provider: 200인데 HTML이면 degraded이고 캐시하지 않는다', async () => {
  const http = makeHttp(() => HTML_200);
  const hn = createHackerNewsProvider(deps(http));
  const r = await hn.search({ query: 'rag', limit: 10 });
  assert.deepEqual(r, { items: [], degraded: [{ source: 'Hacker News', reason: FETCH_FAILED_REASON }] });
  await hn.search({ query: 'rag', limit: 10 });
  assert.equal(http.calls.length, 2);
});

test('HN provider: hits 배열이 없는 JSON도 degraded', async () => {
  const hn = createHackerNewsProvider(deps(makeHttp(() => '{"message":"x"}')));
  const r = await hn.search({ query: 'rag', limit: 10 });
  assert.equal(r.degraded.length, 1);
});

test('HN provider: 정상적인 빈 결과는 degraded가 아니고 다시 가져온다', async () => {
  const http = makeHttp(() => '{"hits":[]}');
  const hn = createHackerNewsProvider(deps(http));
  const r = await hn.search({ query: 'rag', limit: 10 });
  assert.deepEqual(r, { items: [], degraded: [] });
  await hn.search({ query: 'rag', limit: 10 });
  assert.equal(http.calls.length, 2);
});

test('GitHub provider: 200인데 HTML이면 degraded이고 캐시하지 않는다', async () => {
  const http = makeHttp(() => HTML_200);
  const gh = createGithubProvider(deps(http));
  const r = await gh.search({ query: 'rag', limit: 10 });
  assert.deepEqual(r, { items: [], degraded: [{ source: 'GitHub', reason: FETCH_FAILED_REASON }] });
  await gh.search({ query: 'rag', limit: 10 });
  assert.equal(http.calls.length, 2);
});

// ─── Stack Overflow ───

test('SO 검색 URL: 90일·투표순·본문 포함, 키는 있을 때만', () => {
  assert.equal(
    buildSoUrl({ query: 'rag agents', fromEpochSec: 1_692_224_000, limit: 8, key: '' }),
    'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes&q=rag+agents&site=stackoverflow&fromdate=1692224000&pagesize=8&filter=withbody',
  );
  assert.ok(buildSoUrl({ query: 'x', fromEpochSec: 1, limit: 8, key: 'k1' }).endsWith('&key=k1'));
});

test('SO 응답 파싱', () => {
  const items = parseSoSearch(fixture('so-search.json'));
  // stackoverflow.com이 아닌 링크는 버린다.
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: 'RAG retriever returns irrelevant chunks "sometimes"',
    url: 'https://stackoverflow.com/questions/79923286/rag-retriever-returns-irrelevant-chunks',
    author: 'dev&ops',
    tags: ['python', 'langchain', 'rag'],
    score: 7,
    answerCount: 2,
    isAnswered: true,
    hasAcceptedAnswer: true,
    viewCount: 605,
    publishedAt: new Date(1792074068 * 1000).toISOString(),
    text: 'My retriever returns unrelated chunks.',
  });
  // 음수 점수는 그대로, 작성자가 없으면 빈 문자열, 태그는 5개까지.
  assert.equal(items[1].score, -1);
  assert.equal(items[1].author, '');
  assert.equal(items[1].tags.length, 5);
  assert.equal(items[1].hasAcceptedAnswer, false);
});

test('SO 파서는 깨진 JSON에 빈 배열', () => {
  assert.deepEqual(parseSoSearch('{'), []);
});

test('SO provider: 90일 전 기준으로 부르고 결과를 캐시한다', async () => {
  const http = makeHttp(() => fixture('so-search.json'));
  const so = createStackOverflowProvider({ ...deps(http), key: '' });

  const first = await so.search({ query: 'rag', limit: CS_MAX.questions });
  await so.search({ query: 'rag', limit: CS_MAX.questions });

  assert.equal(first.items.length, 2);
  assert.deepEqual(first.degraded, []);
  assert.equal(http.calls.length, 1);
  // makeClock 기본 시각 1_700_000_000_000ms → 90일 전 1_692_224_000초
  assert.ok(http.calls[0].url.includes('fromdate=1692224000'));
});

test('SO provider: 400·429는 한도 사유, 그 밖은 일반 사유, 캐시하지 않는다', async () => {
  for (const [status, reason] of [[400, SO_LIMIT_REASON], [429, SO_LIMIT_REASON], [500, '자료를 가져오지 못했습니다.']]) {
    const http = makeHttp(() => upstream(status));
    const so = createStackOverflowProvider({ ...deps(http), key: '' });
    const r = await so.search({ query: 'rag', limit: 8 });
    assert.deepEqual(r, { items: [], degraded: [{ source: 'Stack Overflow', reason }] });
    await so.search({ query: 'rag', limit: 8 });
    assert.equal(http.calls.length, 2);
  }
});

test('SO provider: 200인데 HTML이거나 items가 없으면 degraded', async () => {
  for (const body of ['<html>blocked</html>', '{"quota_max":300}']) {
    const so = createStackOverflowProvider({ ...deps(makeHttp(() => body)), key: '' });
    const r = await so.search({ query: 'rag', limit: 8 });
    assert.equal(r.items.length, 0);
    assert.equal(r.degraded[0].source, 'Stack Overflow');
  }
});

test('SO provider: 키는 URL에만 싣고 사유·캐시 키에 남기지 않는다', async () => {
  const KEY = 'se-key-SECRET123';
  const http = makeHttp(() => upstream(400));
  const cacheKeys = [];
  const d = deps(http);
  const cache = { get: (k) => { cacheKeys.push(k); return undefined; }, set: (k) => cacheKeys.push(k) };
  const so = createStackOverflowProvider({ ...d, cache, key: KEY });
  const r = await so.search({ query: 'rag', limit: 8 });
  assert.ok(http.calls[0].url.includes(`key=${KEY}`));
  assert.ok(!JSON.stringify(r).includes(KEY));
  assert.ok(cacheKeys.every((k) => !k.includes(KEY)));
});

test('기본 허용 목록에 Stack Exchange·Lobsters가 있고 SE 키 기본값은 빈 문자열', () => {
  const config = loadConfig({
    MY_SECRET_PASSWORD: 'x', LLM_MODE: 'mock', EXTERNAL_ALLOWLIST: undefined, STACKEXCHANGE_KEY: undefined,
  });
  for (const host of ['api.stackexchange.com', 'lobste.rs']) {
    assert.ok(config.externalAllowlist.includes(host), host);
  }
  assert.equal(config.stackexchangeKey, '');
});
