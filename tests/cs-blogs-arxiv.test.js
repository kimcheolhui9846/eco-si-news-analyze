import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTtlCache, createCircuitBreaker, loadConfig } from '../server.js';
import {
  TECH_BLOGS, parseBlogFeed, createTechBlogProvider, queryTokens, matchesTokens,
} from '../lib/providers/tech-blogs.js';
import { buildArxivCsUrl, createArxivCsProvider } from '../lib/providers/arxiv-cs.js';
import { parseArxiv, parseArxivCs } from '../lib/providers/papers.js';
import { makeClock } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-09T00:00:00Z');
const TOSS = TECH_BLOGS.find((b) => b.id === 'toss');
const NVIDIA = TECH_BLOGS.find((b) => b.id === 'nvidia');

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
const deps = (http, clock = makeClock(NOW)) => ({
  http,
  clock,
  cache: createTtlCache({ ttlMs: 21_600_000, maxEntries: 100, clock }),
  makeBreaker: () => createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, clock }),
});

// ─── 블로그 ───

test('블로그는 10곳이고 모든 호스트가 기본 허용 목록에 있다', () => {
  assert.equal(TECH_BLOGS.length, 10);
  assert.equal(new Set(TECH_BLOGS.map((b) => b.id)).size, 10);
  const allow = new Set(loadConfig({
    MY_SECRET_PASSWORD: 'x', LLM_MODE: 'mock', EXTERNAL_ALLOWLIST: undefined,
  }).externalAllowlist);
  for (const b of TECH_BLOGS) {
    assert.ok(b.url.startsWith('https://'), b.id);
    assert.ok(allow.has(new URL(b.url).hostname), b.id);
  }
});

test('RSS 블로그 파싱: 본문 없는 글은 요약을 비운다', () => {
  const items = parseBlogFeed(fixture('blog-rss.xml'), TOSS);
  assert.equal(items.length, 4);
  assert.deepEqual(items[0], {
    title: 'Hybrid search for better RAG',
    url: 'https://toss.tech/article/hybrid-rag',
    blog: '토스 기술 블로그',
    summary: 'We combined BM25 and dense retrieval to improve RAG answers.',
    publishedAt: '2026-10-27T07:05:00.000Z',
  });
  assert.equal(items[3].summary, '');
});

test('Atom 블로그 파싱: 링크 없는 항목은 버린다', () => {
  assert.deepEqual(parseBlogFeed(fixture('blog-atom.xml'), NVIDIA), [{
    title: 'Accelerating RAG Pipelines on GPUs',
    url: 'https://developer.nvidia.com/blog/accelerating-rag/',
    blog: 'NVIDIA Developer',
    summary: 'How to speed up retrieval & generation.',
    publishedAt: '2026-11-04T17:00:00.000Z',
  }]);
});

test('RSS 블로그 파싱: 2048자를 넘는 링크의 항목은 버린다', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
<item><title>Too long</title><link>https://toss.tech/${'x'.repeat(2100)}</link><pubDate>Mon, 02 Nov 2026 00:00:00 GMT</pubDate><description>body</description></item>
<item><title>Normal</title><link>https://toss.tech/article/normal</link><pubDate>Mon, 02 Nov 2026 00:00:00 GMT</pubDate><description>body</description></item>
</channel></rss>`;
  assert.deepEqual(parseBlogFeed(xml, TOSS).map((i) => i.title), ['Normal']);
});

test('깨진 피드는 빈 배열', () => {
  assert.deepEqual(parseBlogFeed('<rss', TOSS), []);
  assert.deepEqual(parseBlogFeed('', TOSS), []);
});

test('검색어 토큰: 영어는 낱말 시작에서만, 한글은 부분 일치', () => {
  const rag = queryTokens('RAG');
  assert.ok(matchesTokens({ title: 'Better RAG', summary: '' }, rag));
  assert.equal(matchesTokens({ title: 'Storage engine', summary: '' }, rag), false);
  assert.ok(matchesTokens({ title: '검색 증강 생성', summary: '' }, queryTokens('검색')));
  // 한 글자 낱말은 다른 낱말이 있으면 버린다.
  assert.deepEqual(queryTokens('a rag'), ['rag']);
  assert.deepEqual(queryTokens('a'), ['a']);
});

test('블로그 provider: 최근 60일·검색어로 거르고 최신순, 실패는 블로그별 degraded', async () => {
  const http = makeHttp((url) => {
    if (url.startsWith('https://toss.tech/')) return fixture('blog-rss.xml');
    if (url.startsWith('https://developer.nvidia.com/')) return fixture('blog-atom.xml');
    return new Error('down');
  });
  const r = await createTechBlogProvider(deps(http)).search({ query: 'rag', limit: 8 });

  assert.deepEqual(r.items.map((i) => i.title), ['Accelerating RAG Pipelines on GPUs', 'Hybrid search for better RAG']);
  assert.equal(r.degraded.length, 8);
  assert.deepEqual(r.degraded[0], { source: 'Google Research', reason: '자료를 가져오지 못했습니다.' });
});

test('블로그 provider: 상한까지만 돌려준다', async () => {
  const http = makeHttp((url) => (url.startsWith('https://toss.tech/') ? fixture('blog-rss.xml') : new Error('down')));
  const r = await createTechBlogProvider(deps(http)).search({ query: 'rag', limit: 0 });
  assert.deepEqual(r.items, []);
});

// ─── arXiv CS ───

test('arXiv CS URL: 낱말마다 all: AND, cs.* 분류, 최신 제출순', () => {
  assert.equal(
    buildArxivCsUrl({ query: 'large language model', limit: 8 }),
    'https://export.arxiv.org/api/query?search_query=all:large+AND+all:language+AND+all:model+AND+cat:cs.*&sortBy=submittedDate&sortOrder=descending&max_results=8',
  );
  assert.ok(buildArxivCsUrl({ query: 'a&b', limit: 8 }).includes('all:a%26b'));
});

test('parseArxivCs는 주 분류를 담고 parseArxiv는 기존 형태 그대로다', () => {
  const cs = parseArxivCs(fixture('arxiv-battery.xml'));
  const plain = parseArxiv(fixture('arxiv-battery.xml'));

  assert.ok(cs.length > 0);
  assert.equal(cs[0].category, 'cs.CE');
  for (const item of cs) assert.equal(typeof item.category, 'string');
  for (const item of plain) assert.equal(Object.hasOwn(item, 'category'), false);
  assert.deepEqual(cs.map(({ category, ...rest }) => rest), plain);
});

test('arXiv CS provider: 상한·캐시', async () => {
  const http = makeHttp(() => fixture('arxiv-battery.xml'));
  const arxiv = createArxivCsProvider(deps(http));

  const first = await arxiv.search({ query: 'battery', limit: 2 });
  await arxiv.search({ query: 'battery', limit: 2 });

  assert.equal(first.items.length, 2);
  assert.deepEqual(first.degraded, []);
  assert.equal(http.calls.length, 1);
  assert.ok(http.calls[0].url.includes('cat:cs.*'));
});

// ─── 형식이 틀린 200 응답은 실패다 ───

test('블로그 provider: 200인데 HTML이면 degraded이고 캐시하지 않는다', async () => {
  const http = makeHttp(() => '<!doctype html><html><body>challenge</body></html>');
  const provider = createTechBlogProvider(deps(http));
  const r = await provider.search({ query: 'rag', limit: 8 });
  assert.equal(r.degraded.length, TECH_BLOGS.length);
  assert.deepEqual(r.degraded[0], { source: 'Google Research', reason: '자료를 가져오지 못했습니다.' });
  await provider.search({ query: 'rag', limit: 8 });
  assert.equal(http.calls.length, TECH_BLOGS.length * 2);
});

test('블로그 provider: 항목이 하나도 없는 피드는 degraded', async () => {
  const http = makeHttp(() => '<rss version="2.0"><channel><title>x</title></channel></rss>');
  const r = await createTechBlogProvider(deps(http)).search({ query: 'rag', limit: 8 });
  assert.equal(r.degraded.length, TECH_BLOGS.length);
});

test('arXiv CS provider: 200인데 HTML이면 degraded이고 캐시하지 않는다', async () => {
  const http = makeHttp(() => '<!doctype html><html><body>blocked</body></html>');
  const arxiv = createArxivCsProvider(deps(http));
  const r = await arxiv.search({ query: 'rag', limit: 2 });
  assert.deepEqual(r, { items: [], degraded: [{ source: 'arXiv', reason: '자료를 가져오지 못했습니다.' }] });
  await arxiv.search({ query: 'rag', limit: 2 });
  assert.equal(http.calls.length, 2);
});

test('arXiv CS provider: 정상적인 빈 결과는 degraded가 아니고 다시 가져온다', async () => {
  const http = makeHttp(() => '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>q</title></feed>');
  const arxiv = createArxivCsProvider(deps(http));
  const r = await arxiv.search({ query: 'rag', limit: 2 });
  assert.deepEqual(r, { items: [], degraded: [] });
  await arxiv.search({ query: 'rag', limit: 2 });
  assert.equal(http.calls.length, 2);
});
