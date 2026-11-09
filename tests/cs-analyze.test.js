import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createMockLlmClient } from '../server.js';
import { CS_JSON_SCHEMA, CS_MOCK_REPORT } from '../lib/modes/cs-schema.js';
import { bootstrap, makeClock, makeMockLlm, TEST_PASSWORD } from './helpers.js';
import { csData, newsItem, paper } from './cs-fixtures.js';

const csBody = (over = {}) => ({ mode: 'cs', ...csData(over) });

const setup = () => {
  const base = createMockLlmClient({ [CS_JSON_SCHEMA.name]: CS_MOCK_REPORT });
  const llm = makeMockLlm((req) => base.complete(req));
  const { app } = bootstrap({ clock: makeClock(), llm });
  return { app, llm };
};
const login = async (app) =>
  (await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD })).body.token;
const estimate = (app, token, body) =>
  request(app).post('/api/analyze/estimate').set('Authorization', `Bearer ${token}`).send(body);
const analyze = (app, token, body, confirmToken) => {
  const call = request(app).post('/api/analyze/news').set('Authorization', `Bearer ${token}`);
  if (confirmToken) call.set('X-Confirm-Token', confirmToken);
  return call.send(body);
};

test('CS 견적 → 분석이 CS 보고서·출처·품질을 돌려준다', async () => {
  const { app } = setup();
  const token = await login(app);

  const est = await estimate(app, token, csBody());
  assert.equal(est.status, 200);
  assert.equal(est.body.sourceCount, 6);

  const res = await analyze(app, token, csBody(), est.body.confirmToken);
  assert.equal(res.status, 200);
  assert.ok(res.body.analysis.summary.includes('CS 동향'));
  assert.deepEqual(res.body.analysis.keyDevelopments[0].sourceIds, ['P1']);
  assert.deepEqual(res.body.sources.map((s) => s.sourceId), ['P1', 'P2', 'H1', 'S1', 'B1', 'G1']);
  assert.equal(res.body.meta.quality.score, 100);
  assert.equal(res.body.meta.sourceCount, 6);
  assert.deepEqual(res.body.meta.counts, { papers: 2, community: 1, questions: 0, news: 1, blogs: 1, repos: 1 });
});

test('기본 mock 모드(LLM 주입 없음)에서도 CS 보고서가 나온다', async () => {
  const { app } = bootstrap({ clock: makeClock() });
  const token = await login(app);
  const est = await estimate(app, token, csBody());
  const res = await analyze(app, token, csBody(), est.body.confirmToken);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.analysis.keyDevelopments));
});

test('LLM에 CS 시스템 프롬프트와 CS 응답 스키마를 넘긴다', async () => {
  const { app, llm } = setup();
  const token = await login(app);
  const est = await estimate(app, token, csBody());
  await analyze(app, token, csBody(), est.body.confirmToken);

  const call = llm.calls[0];
  assert.equal(call.jsonSchema.name, 'cs_trend_briefing');
  assert.ok(call.system.includes('CS(컴퓨터 과학) 기술 동향 분석가'));
  assert.ok(call.user.includes('[커뮤니티 (Hacker News·Lobsters)]'));
});

test('투자 견적 토큰으로 CS 분석을 실행할 수 없다(428)', async () => {
  const { app, llm } = setup();
  const token = await login(app);
  const est = await estimate(app, token, { newsList: [newsItem()] });

  const res = await analyze(app, token, csBody(), est.body.confirmToken);
  assert.equal(res.status, 428);
  assert.equal(res.body.error.code, 'CONFIRMATION_REQUIRED');
  assert.equal(llm.calls.length, 0);
});

test('CS 견적 토큰으로 투자 분석을 실행할 수 없다(428)', async () => {
  const { app, llm } = setup();
  const token = await login(app);
  const est = await estimate(app, token, csBody());

  const res = await analyze(app, token, { newsList: [newsItem()] }, est.body.confirmToken);
  assert.equal(res.status, 428);
  assert.equal(llm.calls.length, 0);
});

test('CS 자료가 3건 미만이면 견적이 422', async () => {
  const { app } = setup();
  const token = await login(app);
  const res = await estimate(app, token, { mode: 'cs', papers: [paper(1)], newsList: [newsItem()] });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'INSUFFICIENT_DATA');
});

test('CS 본문에 모르는 키가 있으면 400', async () => {
  const { app } = setup();
  const token = await login(app);
  const res = await estimate(app, token, { ...csBody(), instruments: [] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_REQUEST');
});

test('같은 CS 요청의 두 번째 분석은 캐시에서 나온다', async () => {
  const { app, llm } = setup();
  const token = await login(app);
  const est = await estimate(app, token, csBody());
  await analyze(app, token, csBody(), est.body.confirmToken);

  const again = await analyze(app, token, csBody());
  assert.equal(again.status, 200);
  assert.equal(again.body.meta.cached, true);
  assert.equal(llm.calls.length, 1);
});
