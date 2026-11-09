import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createMockLlmClient } from '../server.js';
import { bootstrap, makeClock, makeMockLlm, TEST_PASSWORD } from './helpers.js';
import { PAPER_JSON_SCHEMA, PAPER_MOCK_REPORT } from '../lib/modes/paper-schema.js';

const SHORT = readFileSync(new URL('./fixtures/arxiv-html-short.html', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-09T00:00:00Z');

/** 마지막 장을 아주 길게 만든 논문. 25,000토큰 예산을 넘긴다. */
const LONG = SHORT.replace('We thank the reviewers.', 'We thank the reviewers. ' + 'lorem ipsum '.repeat(12_000));

const makeHttp = (handler) => {
  const calls = [];
  return { calls, async get(url, opts) { calls.push({ url, opts }); return handler(url); } };
};
const ok = (text) => async (url) => ({ status: 200, text, url });
const boot = (http) => bootstrap({ clock: makeClock(NOW), http, env: { EXTERNAL_ALLOWLIST: 'arxiv.org' } });
const login = async (app) =>
  (await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD })).body.token;
const collect = (app, token, body) =>
  request(app).post('/api/research/collect').set('Authorization', `Bearer ${token}`).send(body);
const analyze = (app, token, body, confirm) => {
  const call = request(app).post('/api/analyze/news').set('Authorization', `Bearer ${token}`);
  if (confirm) call.set('X-Confirm-Token', confirm);
  return call.send(body);
};

test('논문 수집: 링크를 ID로 바꿔 HTML을 가져오고 장·목차·견적·토큰을 준다', async () => {
  const http = makeHttp(ok(SHORT));
  const { app } = boot(http);
  const token = await login(app);
  const res = await collect(app, token, { mode: 'paper', arxiv: 'https://arxiv.org/abs/2611.00001v2' });

  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  assert.equal(http.calls[0].url, 'https://arxiv.org/html/2611.00001v2');
  assert.equal(res.body.mode, 'paper');
  assert.equal(res.body.paper.title, 'Tiny MoE Retrieval');
  assert.equal(res.body.paper.url, 'https://arxiv.org/abs/2611.00001v2');
  assert.deepEqual(res.body.paper.sections.map((s) => s.id), ['S0', 'S1', 'S2', 'S3', 'S4']);
  assert.deepEqual(res.body.paper.truncated, []);
  assert.deepEqual(res.body.collected.outline.map((o) => o.status), ['full', 'full', 'full', 'full', 'full']);
  assert.equal(res.body.collected.sectionCount, 5);
  assert.equal(res.body.collected.truncatedCount, 0);
  assert.ok(res.body.estimate.estimatedCostUsd > 0);
  assert.match(res.body.confirmToken, /^ct_/);
});

test('논문 수집 토큰으로 그대로 분석한다(cacheKey 일치) — 장이 출처가 되고 품질 검사가 돈다', async () => {
  const { app } = boot(makeHttp(ok(SHORT)));
  const token = await login(app);
  const c = (await collect(app, token, { mode: 'paper', arxiv: '2611.00001' })).body;
  const res = await analyze(app, token, { mode: 'paper', paper: c.paper }, c.confirmToken);

  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  assert.ok(res.body.analysis.summary.includes('[MOCK]'));
  assert.deepEqual(res.body.sources.map((s) => [s.sourceId, s.type]), [
    ['S0', 'section'], ['S1', 'section'], ['S2', 'section'], ['S3', 'section'], ['S4', 'section'],
  ]);
  assert.equal(res.body.sources[4].url, 'https://arxiv.org/html/2611.00001#Sx1');
  assert.equal(res.body.sources[0].source, 'arXiv 2611.00001');
  assert.equal(res.body.meta.sourceCount, 5);
  assert.deepEqual(res.body.meta.paper, { id: '2611.00001', title: 'Tiny MoE Retrieval' });
  // mock은 keyResults가 비어 있고 본문에 'Experiments' 장이 있다 → 경고 1건.
  assert.equal(res.body.meta.quality.score, 95);
});

test('긴 논문은 뒤쪽 장을 잘라 표시한다', async () => {
  const { app } = boot(makeHttp(ok(LONG)));
  const token = await login(app);
  const res = await collect(app, token, { mode: 'paper', arxiv: '2611.00001' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.paper.truncated, [{ id: 'S4', heading: 'Acknowledgements', partial: true }]);
  assert.equal(res.body.collected.outline.at(-1).status, 'partial');
  assert.equal(res.body.collected.truncatedCount, 1);
  assert.ok(res.body.estimate.estimatedInputTokens <= 27_000);
});

test('HTML 판이 없으면 422 FULLTEXT_UNAVAILABLE', async () => {
  const http = makeHttp(async () => { throw Object.assign(new Error('x'), { upstreamStatus: 404 }); });
  const { app } = boot(http);
  const token = await login(app);
  const res = await collect(app, token, { mode: 'paper', arxiv: '2401.99999' });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'FULLTEXT_UNAVAILABLE');
  assert.equal(res.body.error.message, '이 논문은 arXiv HTML 판이 없어 전문 분석을 할 수 없습니다.');
});

test('arXiv 장애는 502 COLLECTION_FAILED', async () => {
  const http = makeHttp(async () => { throw Object.assign(new Error('x'), { upstreamStatus: 503 }); });
  const { app } = boot(http);
  const token = await login(app);
  const res = await collect(app, token, { mode: 'paper', arxiv: '2401.04088' });
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, 'COLLECTION_FAILED');
});

test('형식 오류·모르는 키는 400이고 arXiv를 부르지 않는다', async () => {
  const http = makeHttp(ok(SHORT));
  const { app } = boot(http);
  const token = await login(app);
  for (const body of [
    { mode: 'paper', arxiv: 'https://evil.com/abs/2401.04088' },
    { mode: 'paper', arxiv: 'not an id' },
    { mode: 'paper', arxiv: '' },
    { mode: 'paper' },
    { mode: 'paper', arxiv: '2401.04088', query: 'x' },
  ]) {
    const res = await collect(app, token, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'INVALID_REQUEST');
  }
  const bad = await collect(app, token, { mode: 'paper', arxiv: 'not an id' });
  assert.equal(bad.body.error.message, 'arXiv ID 또는 arXiv 링크를 입력해 주세요. 예: 2401.04088');
  assert.equal(http.calls.length, 0);
});

test('수집 결과를 바꾸면 확인 토큰이 통하지 않는다(428)', async () => {
  const { app } = boot(makeHttp(ok(SHORT)));
  const token = await login(app);
  const c = (await collect(app, token, { mode: 'paper', arxiv: '2611.00001' })).body;
  const tampered = { ...c.paper, sections: c.paper.sections.map((s) => (s.id === 'S3' ? { ...s, text: `${s.text} extra` } : s)) };
  const res = await analyze(app, token, { mode: 'paper', paper: tampered }, c.confirmToken);
  assert.equal(res.status, 428);
});

test('투자 견적 토큰으로 논문 분석을 실행할 수 없다(428)', async () => {
  const { app } = boot(makeHttp(ok(SHORT)));
  const token = await login(app);
  const c = (await collect(app, token, { mode: 'paper', arxiv: '2611.00001' })).body;
  const article = {
    title: '엔비디아 실적', content: '데이터센터 매출이 늘었다.', source: '연합뉴스',
    url: 'https://example.com/a/1', publishedAt: '2026-08-30T09:00:00Z',
  };
  const est = await request(app).post('/api/analyze/estimate').set('Authorization', `Bearer ${token}`)
    .send({ newsList: [article] });
  assert.equal(est.status, 200);
  const res = await analyze(app, token, { mode: 'paper', paper: c.paper }, est.body.confirmToken);
  assert.equal(res.status, 428);
  assert.equal(res.body.error.code, 'CONFIRMATION_REQUIRED');
});

test('분석 요청 검증: 장 ID 형식·중복·arXiv 밖 URL·초록뿐인 본문', async () => {
  const { app } = boot(makeHttp(ok(SHORT)));
  const token = await login(app);
  const c = (await collect(app, token, { mode: 'paper', arxiv: '2611.00001' })).body;
  const est = (paper) => request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send({ mode: 'paper', paper });

  const s = c.paper.sections;
  assert.equal((await est({ ...c.paper, sections: [{ ...s[0], id: 'X1' }, ...s.slice(1)] })).status, 400);
  assert.equal((await est({ ...c.paper, sections: [s[0], s[1], { ...s[2], id: 'S1' }] })).status, 400);
  assert.equal((await est({ ...c.paper, url: 'https://evil.com/abs/2611.00001' })).status, 400);
  assert.equal((await est({ ...c.paper, sections: [{ ...s[1], tokens: 3 }] })).status, 400);
  const onlyAbstract = await est({ ...c.paper, sections: [s[0]] });
  assert.equal(onlyAbstract.status, 422);
  assert.equal(onlyAbstract.body.error.code, 'INSUFFICIENT_DATA');
});

test('LLM에 논문 시스템 프롬프트와 논문 응답 스키마를 넘긴다', async () => {
  const base = createMockLlmClient({ [PAPER_JSON_SCHEMA.name]: PAPER_MOCK_REPORT });
  const llm = makeMockLlm((req) => base.complete(req));
  const { app } = bootstrap({ clock: makeClock(NOW), http: makeHttp(ok(SHORT)), llm, env: { EXTERNAL_ALLOWLIST: 'arxiv.org' } });
  const token = await login(app);
  const c = (await collect(app, token, { mode: 'paper', arxiv: '2611.00001' })).body;
  await analyze(app, token, { mode: 'paper', paper: c.paper }, c.confirmToken);

  const call = llm.calls[0];
  assert.equal(call.jsonSchema.name, 'paper_critical_reading');
  assert.ok(call.system.includes('비판적 읽기'));
  assert.ok(call.user.includes('[S3] 3 Experiments'));
});

test('한도를 넘는 저자·제목·앵커가 있는 논문도 수집 결과가 분석을 통과한다', async () => {
  const names = Array.from({ length: 101 }, (_, i) => `<span class="ltx_creator"><span class="ltx_personname">${i === 0 ? 'A'.repeat(250) : `Author ${i}`}</span></span>`).join('');
  const html = SHORT
    .replace(/<div class="ltx_authors">[\s\S]*?<\/div>\r?\n<div id="abstract1"/, `<div class="ltx_authors">${names}</div>\n<div id="abstract1"`)
    .replace('</span>Method</h2>', `</span>${'M'.repeat(301)}</h2>`)
    .replace('<section id="S2" class="ltx_section">', '<section id="S2_bad-anchor!" class="ltx_section">');
  const { app } = boot(makeHttp(ok(html)));
  const token = await login(app);
  const c = (await collect(app, token, { mode: 'paper', arxiv: '2611.00001' })).body;
  assert.equal(c.paper.authors.length, 100);
  const res = await analyze(app, token, { mode: 'paper', paper: c.paper }, c.confirmToken);
  assert.equal(res.status, 200, JSON.stringify(res.body.error));
});

test('수집 결과가 분석 스키마에 맞지 않으면 승인 전에 502 COLLECTION_FAILED로 막는다', async () => {
  // 장 201개 — 파서는 막지 않지만 분석 스키마는 200개까지만 받는다.
  const secs = Array.from({ length: 201 }, (_, i) => `<section id="S${i + 1}" class="ltx_section"><h2 class="ltx_title ltx_title_section">H${i}</h2><div class="ltx_para"><p class="ltx_p">${'body text '.repeat(5)}</p></div></section>`).join('');
  const html = SHORT.replace(/<section id="S1"[\s\S]*<section id="bib"/, `${secs}<section id="bib"`);
  const { app } = boot(makeHttp(ok(html)));
  const token = await login(app);
  const res = await collect(app, token, { mode: 'paper', arxiv: '2611.00001' });
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, 'COLLECTION_FAILED');
  assert.equal(res.body.error.message, 'arXiv에서 논문 본문을 가져오지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
  assert.equal(res.body.confirmToken, undefined);
});

test('25k 토큰급 본문 + 저자 100명도 수집 → 분석이 200이다(상한 여유)', async () => {
  const names = Array.from({ length: 100 }, (_, i) => `<span class="ltx_creator"><span class="ltx_personname">Author Name ${i}</span></span>`).join('');
  // 장 4개 x 약 25,000자 = 약 25k 토큰(글자/4). 장마다 문단을 나눠 줄 수를 늘린다.
  const para = `<div class="ltx_para"><p class="ltx_p">${'alpha beta gamma delta '.repeat(25)}</p></div>`;
  const secs = Array.from({ length: 4 }, (_, i) =>
    `<section id="S${i + 1}" class="ltx_section"><h2 class="ltx_title ltx_title_section">Part ${i + 1}</h2>${para.repeat(43)}</section>`).join('');
  const html = SHORT
    .replace(/<div class="ltx_authors">[\s\S]*?<\/div>\r?\n<div id="abstract1"/, `<div class="ltx_authors">${names}</div>\n<div id="abstract1"`)
    .replace(/<section id="S1"[\s\S]*<section id="bib"/, `${secs}<section id="bib"`);
  const { app } = boot(makeHttp(ok(html)));
  const token = await login(app);
  const col = await collect(app, token, { mode: 'paper', arxiv: '2611.00001' });
  assert.equal(col.status, 200, JSON.stringify(col.body.error));
  const c = col.body;
  assert.ok(c.estimate.estimatedInputTokens >= 20_000, String(c.estimate.estimatedInputTokens));
  assert.equal(c.paper.authors.length, 100);
  const res = await analyze(app, token, { mode: 'paper', paper: c.paper }, c.confirmToken);
  assert.equal(res.status, 200, JSON.stringify(res.body.error));
});
