import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { bootstrap, makeClock, makeMockLlm, TEST_PASSWORD } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const ROUTES = {
  'news.google.com': fixture('google-news-ko.xml'),
  'yna.co.kr': fixture('yonhap-economy.xml'),
  'etnews.com': fixture('yonhap-economy.xml'),
  'feeds.finance.yahoo.com': fixture('google-news-ko.xml'),
  'query1.finance.yahoo.com/v8': fixture('yahoo-chart-nvda.json'),
  'api.coingecko.com': fixture('coingecko-bitcoin.json'),
  'data.sec.gov': fixture('sec-concept-revenues.json'),
  'ebi.ac.uk': fixture('europepmc-battery.json'),
  'export.arxiv.org': fixture('arxiv-battery.xml'),
  'clinicaltrials.gov': fixture('clinicaltrials-obesity.json'),
};

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

const login = async (agent) => {
  const res = await agent.post('/api/auth/login').send({ password: TEST_PASSWORD });
  return res.body.token;
};

const boot = (over = {}) => bootstrap({
  clock: makeClock(),
  http: over.http ?? makeHttp(),
  llm: makeMockLlm(() => ({ content: JSON.stringify({ report: '보고서' }), model: 'mock' })),
  env: over.env,
});

/** 수집 결과를 분석 요청 본문으로 옮긴다. 빈 자료는 넣지 않는다. */
const analyzeBodyFrom = (collected) => {
  const body = { newsList: collected.newsList };
  if (collected.marketData) body.marketData = collected.marketData;
  if (collected.financial) body.financial = collected.financial;
  if (collected.research?.length) body.research = collected.research;
  if (collected.experiments?.length) body.experiments = collected.experiments;
  return body;
};

// ─── 하위 호환 ───

test('include를 보내지 않으면 Phase 2a와 같이 동작한다', async () => {
  const { app } = boot();
  const agent = request.agent(app);
  const token = await login(agent);

  const res = await agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: 'NVDA earnings', lang: 'en' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.collected.included, ['news', 'market']);
  assert.equal(res.body.research, undefined);
  assert.equal(res.body.experiments, undefined);
  assert.equal(res.body.financial, undefined);
});

test('선택하지 않은 provider는 호출되지 않는다', async () => {
  const http = makeHttp();
  const { app } = boot({ http });
  const agent = request.agent(app);
  const token = await login(agent);

  await agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: 'NVDA earnings', lang: 'en' });

  assert.ok(http.calls.every((u) => !u.includes('data.sec.gov')));
  assert.ok(http.calls.every((u) => !u.includes('ebi.ac.uk')));
  assert.ok(http.calls.every((u) => !u.includes('clinicaltrials.gov')));
});

test('news를 빼도 강제로 수집한다', async () => {
  const { app } = boot();
  const agent = request.agent(app);
  const token = await login(agent);

  const res = await agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: 'NVDA earnings', lang: 'en', include: ['research'] });

  assert.equal(res.status, 200);
  assert.ok(res.body.collected.included.includes('news'));
  assert.ok(res.body.newsList.length > 0);
});

// ─── 자료 수집 ───

test('다섯 가지를 모두 선택하면 세 자료가 응답에 실린다', async () => {
  const { app } = boot();
  const agent = request.agent(app);
  const token = await login(agent);

  const res = await agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({
      query: 'nvidia earnings', symbol: 'NVDA', lang: 'en',
      include: ['news', 'market', 'financial', 'research', 'experiments'],
    });

  assert.equal(res.status, 200);
  assert.ok(res.body.research.length > 0);
  assert.ok(res.body.experiments.length > 0);
  assert.ok(res.body.financial.metrics.length > 0);
  assert.equal(res.body.collected.researchCount, res.body.research.length);
  assert.equal(res.body.collected.experimentCount, res.body.experiments.length);
  assert.equal(res.body.collected.financialMetricCount, res.body.financial.metrics.length);
});

test('한국 종목은 CIK가 없어 재무가 빠지고 사유가 남는다', async () => {
  const { app } = boot();
  const agent = request.agent(app);
  const token = await login(agent);

  const res = await agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: '삼성전자 실적', include: ['news', 'financial'] });

  assert.equal(res.body.financial, undefined);
  assert.ok(res.body.collected.degraded.some((d) => d.provider === 'financial'));
});

test('한국어 질의는 영어 논문 DB로 요청을 보내지 않는다', async () => {
  // 스펙 §2.2.1의 완료 기준이다.
  const http = makeHttp();
  const { app } = boot({ http });
  const agent = request.agent(app);
  const token = await login(agent);

  const res = await agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: '배터리 재활용', include: ['news', 'research', 'experiments'] });

  assert.equal(res.status, 200);
  for (const host of ['ebi.ac.uk', 'export.arxiv.org', 'clinicaltrials.gov']) {
    assert.ok(http.calls.every((u) => !u.includes(host)), `${host}로 요청이 나갔다`);
  }
  assert.equal(res.body.collected.languageRoute.route, 'ko');
});

test('KCI 키가 없어도 서버가 기동하고 나머지가 동작한다', async () => {
  const { app } = boot({ env: { KCI_API_KEY: '' } });
  const agent = request.agent(app);
  const token = await login(agent);

  const res = await agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: '배터리 재활용', include: ['news', 'market', 'research'] });

  assert.equal(res.status, 200);
  assert.ok(res.body.newsList.length > 0);
  assert.equal(res.body.collected.degraded.some((d) => d.source === 'KCI'), false);
  assert.ok(Array.isArray(res.body.collected.research ?? []));
});

// ─── 비용과 확인 토큰 ───

test('자료가 늘면 예상 입력 토큰이 늘어난다', async () => {
  const { app } = boot();
  const agent = request.agent(app);
  const token = await login(agent);

  const send = (include) => agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: 'nvidia earnings', symbol: 'NVDA', lang: 'en', include });

  const small = await send(['news']);
  const large = await send(['news', 'research', 'experiments']);

  assert.ok(large.body.estimate.estimatedInputTokens > small.body.estimate.estimatedInputTokens);
  assert.ok(large.body.estimate.estimatedCostUsd > small.body.estimate.estimatedCostUsd);
});

test('수집 결과를 그대로 보내면 확인 토큰이 통한다', async () => {
  const { app } = boot();
  const agent = request.agent(app);
  const token = await login(agent);

  const collected = await agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({
      query: 'nvidia earnings', symbol: 'NVDA', lang: 'en',
      include: ['news', 'market', 'financial', 'research', 'experiments'],
    });

  const res = await agent.post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', collected.body.confirmToken)
    .send(analyzeBodyFrom(collected.body));

  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('뉴스만으로 견적받고 논문을 추가해 실행하면 428로 막힌다', async () => {
  // 스펙 §4.5. 작은 자료로 승인받고 큰 자료로 실행하는 우회다.
  const { app } = boot();
  const agent = request.agent(app);
  const token = await login(agent);

  const small = await agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: 'nvidia earnings', symbol: 'NVDA', lang: 'en', include: ['news'] });

  const large = await agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({
      query: 'nvidia earnings', symbol: 'NVDA', lang: 'en',
      include: ['news', 'research', 'experiments'],
    });

  const res = await agent.post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', small.body.confirmToken)   // 작은 견적의 토큰
    .send({
      newsList: small.body.newsList,
      research: large.body.research,                    // 큰 자료
      experiments: large.body.experiments,
    });

  assert.equal(res.status, 428);
  assert.equal(res.body.error.code, 'CONFIRMATION_REQUIRED');
});

test('재무 계산값을 바꾸면 428로 막힌다', async () => {
  const { app } = boot();
  const agent = request.agent(app);
  const token = await login(agent);

  const collected = await agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: 'nvidia earnings', symbol: 'NVDA', lang: 'en', include: ['news', 'financial'] });

  const tampered = structuredClone(collected.body.financial);
  tampered.metrics[0].value = 1;

  const res = await agent.post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', collected.body.confirmToken)
    .send({ newsList: collected.body.newsList, financial: tampered });

  assert.equal(res.status, 428);
});

// ─── 출처 ───

test('출처 배열에 논문·실험 타입이 섞여 나온다', async () => {
  const { app } = boot();
  const agent = request.agent(app);
  const token = await login(agent);

  const collected = await agent.post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({
      query: 'nvidia earnings', symbol: 'NVDA', lang: 'en',
      include: ['news', 'market', 'research', 'experiments'],
    });

  const res = await agent.post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', collected.body.confirmToken)
    .send(analyzeBodyFrom(collected.body));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const types = new Set(res.body.sources.map((s) => s.type));
  assert.ok(types.has('news'));
  assert.ok(types.has('research'));
  assert.ok(types.has('experiment'));
  assert.ok(res.body.sources.some((s) => s.sourceId.startsWith('P')));
  assert.ok(res.body.sources.some((s) => s.sourceId.startsWith('T')));
});
