import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { bootstrap, makeClock, TEST_PASSWORD } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-09T00:00:00Z');

const ROUTES = {
  'export.arxiv.org': fixture('arxiv-battery.xml'),
  'hn.algolia.com': fixture('hn-search.json'),
  'news.google.com': fixture('google-news-ko.xml'),
  'yna.co.kr': fixture('yonhap-economy.xml'),
  'etnews.com': fixture('yonhap-economy.xml'),
  'toss.tech': fixture('blog-rss.xml'),
  'api.github.com': fixture('github-search.json'),
};

/** 경로에 맞는 fixture를 돌려준다. 없는 호스트(나머지 블로그 9곳)는 실패한다. */
const makeHttp = (routes = ROUTES) => {
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

const boot = (http = makeHttp()) => ({ ...bootstrap({ clock: makeClock(NOW), http }), http });
const login = async (app) =>
  (await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD })).body.token;
const collect = (app, token, body) =>
  request(app).post('/api/research/collect').set('Authorization', `Bearer ${token}`).send(body);

/** 클라이언트(client/src/api/client.js)와 같은 규칙. cacheKey 계약의 대조 기준이다. */
const csAnalysisBody = (c) => {
  const body = { mode: 'cs' };
  for (const key of ['newsList', 'papers', 'community', 'blogs', 'repos']) {
    if (c[key]?.length) body[key] = c[key];
  }
  return body;
};

test('CS 수집: 다섯 출처를 모으고 견적·확인 토큰을 준다', async () => {
  const { app } = boot();
  const token = await login(app);
  const res = await collect(app, token, { mode: 'cs', query: 'rag' });

  assert.equal(res.status, 200);
  assert.equal(res.body.mode, 'cs');
  assert.deepEqual(res.body.collected.included, ['papers', 'community', 'news', 'blogs', 'repos']);
  assert.equal(res.body.papers.length, 3);
  assert.equal(res.body.community.length, 2);
  assert.ok(res.body.newsList.length > 0);
  assert.deepEqual(res.body.blogs.map((b) => b.title), ['Hybrid search for better RAG']);
  assert.equal(res.body.repos.length, 2);
  assert.equal(res.body.collected.counts.papers, 3);
  assert.equal(res.body.collected.total,
    3 + 2 + res.body.collected.counts.news + 1 + 2);
  assert.ok(res.body.estimate.estimatedCostUsd > 0);
  assert.match(res.body.confirmToken, /^ct_/);
  // 실패한 블로그 9곳은 블로그별 사유로 남는다.
  const blogDegraded = res.body.collected.degraded.filter((d) => d.provider === 'blogs');
  assert.equal(blogDegraded.length, 9);
  assert.deepEqual(blogDegraded[0], { provider: 'blogs', source: 'Google Research', reason: '자료를 가져오지 못했습니다.' });
});

test('CS 수집 토큰으로 그대로 분석할 수 있다(cacheKey 일치)', async () => {
  const { app } = boot();
  const token = await login(app);
  const c = (await collect(app, token, { mode: 'cs', query: 'rag' })).body;

  const res = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`).set('X-Confirm-Token', c.confirmToken)
    .send(csAnalysisBody(c));

  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  assert.equal(res.body.meta.sourceCount, c.collected.total);
});

test('include로 고른 출처만 부른다', async () => {
  const { app, http } = boot();
  const token = await login(app);
  const res = await collect(app, token, { mode: 'cs', query: 'rag', include: ['papers'] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.collected.included, ['papers']);
  assert.ok(http.calls.every((u) => u.startsWith('https://export.arxiv.org/')));
  assert.deepEqual(res.body.community, []);
});

test('CS 수집 결과가 3건 미만이면 502 COLLECTION_FAILED', async () => {
  const { app } = boot();
  const token = await login(app);
  const res = await collect(app, token, { mode: 'cs', query: 'rag', include: ['community'] });
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, 'COLLECTION_FAILED');
});

test('GitHub 한도 초과는 사유와 함께 degraded로 남는다', async () => {
  const http = makeHttp({ ...ROUTES, 'api.github.com': Object.assign(new Error('x'), { upstreamStatus: 403 }) });
  const { app } = boot(http);
  const token = await login(app);
  const res = await collect(app, token, { mode: 'cs', query: 'rag' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.repos, []);
  assert.ok(res.body.collected.degraded.some((d) =>
    d.provider === 'repos' && d.source === 'GitHub' && d.reason === 'GitHub 검색 한도를 넘었습니다.'));
});

test('CS 수집에 투자 전용 필드나 모르는 범위를 보내면 400', async () => {
  const { app } = boot();
  const token = await login(app);
  for (const body of [
    { mode: 'cs', query: 'rag', symbol: 'NVDA' },
    { mode: 'cs', query: 'rag', include: ['market'] },
    { mode: 'cs' },
  ]) {
    const res = await collect(app, token, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('원본은 3건 이상이어도 중복 제거 뒤 3건 미만이면 502 COLLECTION_FAILED', async () => {
  // 같은 기사 1건을 세 피드(google, yna, etnews)가 똑같이 돌려준다. 원본 3건 -> 제목 중복 제거 뒤 1건.
  const one = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
    <item><title>RAG pipeline news</title><link>https://example.com/a</link>
    <description>rag content</description><pubDate>Mon, 09 Nov 2026 00:00:00 GMT</pubDate></item>
    </channel></rss>`;
  const http = makeHttp({
    'news.google.com': one, 'yna.co.kr': one, 'etnews.com': one,
  });
  const { app } = boot(http);
  const token = await login(app);
  const res = await collect(app, token, { mode: 'cs', query: 'rag', include: ['news'] });

  assert.equal(http.calls.length, 3); // 세 피드가 모두 응답했다(원본 3건).
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, 'COLLECTION_FAILED');
});
