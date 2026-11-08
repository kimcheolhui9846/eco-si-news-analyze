import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createDirectory } from '../server.js';
import {
  analysisBody, bootstrap, makeClock, makeMockLlm, TEST_PASSWORD,
} from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const DART = fixture('dart-samsung-q3.json');
const meta = (code, exchange, nation, currency) => JSON.stringify({
  itemCode: code, symbolCode: code, reutersCode: code,
  currencyType: { code: currency }, stockExchangeType: { code: exchange, name: exchange === 'KS' ? 'KOSPI' : 'NASDAQ', nationCode: nation },
  marketStatus: 'CLOSE', closePrice: '100',
});
const CHART = JSON.stringify([
  { localDate: '20261105', closePrice: 100, accumulatedTradingVolume: 1 },
  { localDate: '20261106', closePrice: 101, accumulatedTradingVolume: 1 },
]);

const makeHttp = () => {
  const calls = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      if (url.includes('news.google.com') || url.includes('yna.co.kr') || url.includes('etnews.com')) {
        return { status: 200, text: fixture('google-news-ko.xml'), url };
      }
      if (url.includes('opendart.fss.or.kr')) return { status: 200, text: DART, url };
      if (url.includes('/chart/')) return { status: 200, text: CHART, url };
      if (url.includes('m.stock.naver.com/api/stock/005930')) return { status: 200, text: meta('005930', 'KS', 'KOR', 'KRW'), url };
      // 나머지 종목의 네이버 메타데이터는 "지원 안 함"으로 중립 응답한다.
      // 예외를 던지면 공유 회로차단기가 열려 삼성전자 시세까지 막힐 수 있다.
      if (url.includes('stock.naver.com/')) return { status: 200, text: '{}', url };
      throw new Error(`라우트 없음: ${url}`);
    },
  };
};

const DIRECTORY = createDirectory({
  us: [['NVDA', '0001045810', 'NVIDIA CORP']],
  kr: [['삼성전자', '005930', '00126380'], ['SK하이닉스', '000660', '00164779']],
});

const login = async (app) => {
  const res = await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD });
  return res.body.token;
};

test('분야 검색은 묶음 종목 배열과 resolution을 돌려준다', async () => {
  const { app } = bootstrap({
    clock: makeClock(Date.parse('2026-11-20T03:00:00Z')),
    llm: makeMockLlm(() => ({ content: '{}', model: 'mock' })),
    http: makeHttp(),
    directory: DIRECTORY,
    env: { OPENDART_API_KEY: 'k' },
  });
  const token = await login(app);
  const res = await request(app).post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: '반도체 업황', include: ['news', 'market', 'financial'] });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.collected.resolution, {
    kind: 'sector', sector: '반도체', symbols: ['NVDA', 'TSM', '005930.KS', '000660.KS'],
  });
  assert.equal(res.body.instruments.length, 4);
  const samsung = res.body.instruments.find((i) => i.symbol === '005930.KS');
  assert.equal(samsung.financial.source, 'dart');
  assert.ok(samsung.marketData);
  // TSM은 디렉터리에 없다 → 재무 사유가 종목 단위로 남는다.
  assert.ok(res.body.collected.degraded.some((d) => d.provider === 'financial' && d.symbol === 'TSM'));
  assert.equal(res.body.marketData, undefined);
  assert.equal(res.body.financial, undefined);
});

test('분석 요청에 같은 규칙으로 되돌려 보내면 확인 토큰이 통한다', async () => {
  const llm = makeMockLlm(() => ({ content: JSON.stringify({ summary: '요약', newsBriefing: [], trendAnalysis: '', scenarios: [], risks: [], monitoringIndicators: [], disclaimer: '면책' }), model: 'mock' }));
  const { app } = bootstrap({
    clock: makeClock(Date.parse('2026-11-20T03:00:00Z')), llm, http: makeHttp(), directory: DIRECTORY,
    env: { OPENDART_API_KEY: 'k' },
  });
  const token = await login(app);
  const c = await request(app).post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: '반도체 업황', include: ['news', 'market', 'financial'] });

  const res = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', c.body.confirmToken)
    .send(analysisBody(c.body));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(llm.calls[0].user.includes("'반도체' 분야 대표 종목"));
  assert.ok(res.body.sources.some((s) => s.source === 'OpenDART'));
});

test('종목을 못 찾으면 instruments가 비고 안내 사유가 붙는다', async () => {
  const { app } = bootstrap({
    clock: makeClock(Date.parse('2026-11-20T03:00:00Z')),
    llm: makeMockLlm(() => ({ content: '{}', model: 'mock' })),
    http: makeHttp(), directory: DIRECTORY,
  });
  const token = await login(app);
  const res = await request(app).post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: '메타버스 시장', include: ['news', 'market', 'financial'] });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.instruments, []);
  assert.equal(res.body.collected.resolution.kind, 'unresolved');
  assert.ok(res.body.collected.degraded.some((d) => d.provider === 'market' && /반도체, AI/.test(d.reason)));
});
