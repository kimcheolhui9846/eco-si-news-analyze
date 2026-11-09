import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { getProfile, splitMode } from '../lib/modes/index.js';
import { investProfile } from '../lib/modes/invest.js';
import { createMockLlmClient } from '../server.js';
import { bootstrap, makeClock, makeMockLlm, TEST_PASSWORD } from './helpers.js';

const article = {
  title: '엔비디아 실적', content: '데이터센터 매출이 늘었다.', source: '연합뉴스',
  url: 'https://example.com/a/1', publishedAt: '2026-08-30T09:00:00Z',
};

const setup = () => {
  const base = createMockLlmClient();
  const llm = makeMockLlm((req) => base.complete(req));
  const { app } = bootstrap({ clock: makeClock(), llm });
  return { app, llm };
};
const login = async (app) =>
  (await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD })).body.token;

test('mode가 없거나 invest면 투자 프로필이다', () => {
  assert.equal(getProfile(undefined), investProfile);
  assert.equal(getProfile('invest'), investProfile);
});

test('모르는 mode는 400 INVALID_REQUEST', () => {
  for (const mode of ['stock', '', null, 5, 'CS ', 'constructor']) {
    assert.throws(
      () => getProfile(mode),
      (e) => e.status === 400 && e.code === 'INVALID_REQUEST' && e.message === '지원하지 않는 분석 모드입니다.',
      String(mode),
    );
  }
});

test('splitMode는 mode를 떼어 내고 나머지를 그대로 둔다', () => {
  assert.deepEqual(splitMode({ mode: 'cs', a: 1 }), { mode: 'cs', body: { a: 1 } });
  assert.deepEqual(splitMode({ a: 1 }), { mode: undefined, body: { a: 1 } });
  const arr = [1];
  assert.equal(splitMode(arr).body, arr);
  assert.equal(splitMode(null).body, null);
});

test('투자 cacheKey 재료에 mode가 들어간다', () => {
  const n = investProfile.normalize({ newsList: [article] });
  assert.equal(investProfile.hashInput(n).mode, 'invest');
});

test('견적: 모르는 mode는 400이고 LLM을 부르지 않는다', async () => {
  const { app, llm } = setup();
  const token = await login(app);
  const res = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send({ mode: 'stock', newsList: [article] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_REQUEST');
  assert.equal(llm.calls.length, 0);
});

test('분석: 모르는 mode는 400이고 LLM을 부르지 않는다', async () => {
  const { app, llm } = setup();
  const token = await login(app);
  const res = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`).set('X-Confirm-Token', 'ct_x')
    .send({ mode: 'stock', newsList: [article] });
  assert.equal(res.status, 400);
  assert.equal(llm.calls.length, 0);
});

test('mode 없이 받은 확인 토큰으로 mode: invest 분석이 통과한다', async () => {
  const { app, llm } = setup();
  const token = await login(app);
  const est = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send({ newsList: [article] });
  const res = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`).set('X-Confirm-Token', est.body.confirmToken)
    .send({ mode: 'invest', newsList: [article] });
  assert.equal(res.status, 200);
  assert.equal(llm.calls.length, 1);
});

test('수집: 모르는 mode는 400', async () => {
  const { app } = setup();
  const token = await login(app);
  const res = await request(app).post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`).send({ mode: 'stock', query: 'x' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_REQUEST');
});
