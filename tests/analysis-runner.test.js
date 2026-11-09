import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { z } from 'zod';
import { createAnalysisRunner } from '../lib/analysis-runner.js';
import {
  ApiError, loadConfig, createMockLlmClient, hashRequest, ANALYSIS_JSON_SCHEMA,
} from '../server.js';
import { BASE_ENV, bootstrap, makeClock, makeMockLlm, TEST_PASSWORD } from './helpers.js';

/** 실행부만 시험하는 최소 프로필. */
const fakeProfile = {
  mode: 'fake',
  buildAnalyzeSchema: () => z.strictObject({ text: z.string().max(10_000) }),
  normalize: (data) => ({ text: data.text }),
  systemPrompt: 'SYSTEM',
  buildUserPrompt: (n, { collectedAt }) => `${collectedAt}\n${n.text}`,
  jsonSchema: { name: 'fake_schema', strict: true, schema: {} },
  hashInput: (n) => ({ mode: 'fake', text: n.text }),
  buildSources: (n, collectedAt) => [{
    sourceId: 'S1', title: n.text, source: 'x', url: 'https://a.com/1',
    publishedAt: collectedAt, collectedAt, type: 'news', relevance: 0,
  }],
  urlWhitelist: () => new Set(['https://a.com/1']),
  qualityContext: (n, sources) => ({ sources: new Map(sources.map((s) => [s.sourceId, s])) }),
  baseMeta: () => ({ sourceCount: 1, duplicatesRemoved: 0 }),
  checks: [],
};

const makeRunner = (env = {}) => {
  const config = loadConfig({ ...BASE_ENV, ...env });
  const clock = makeClock();
  const confirmTokens = new Map();
  const runner = createAnalysisRunner({ config, now: clock, confirmTokens });
  return { runner, config, clock, confirmTokens };
};

test('quote는 프로필로 프롬프트·견적·cacheKey를 만든다', () => {
  const { runner, config, clock } = makeRunner();
  const q = runner.quote(fakeProfile, { text: 'abc' });
  const collectedAt = new Date(clock.now()).toISOString();

  assert.equal(q.collectedAt, collectedAt);
  assert.equal(q.userPrompt, `${collectedAt}\nabc`);
  assert.equal(q.estimatedInputTokens, Math.ceil('SYSTEM'.length / 4) + Math.ceil(q.userPrompt.length / 4));
  assert.equal(q.cacheKey, hashRequest({ mode: 'fake', text: 'abc', model: config.openaiModel }));
  assert.ok(q.estimatedCostUsd > 0);
});

test('prepare는 스키마 위반을 400으로 거부한다', () => {
  const { runner } = makeRunner();
  assert.throws(
    () => runner.prepare(fakeProfile, { text: 1 }),
    (e) => e instanceof ApiError && e.status === 400 && e.code === 'INVALID_REQUEST',
  );
});

test('prepare는 너무 큰 요청을 413으로 거부한다', () => {
  const { runner } = makeRunner({ MAX_PROMPT_CHARS: '50' });
  assert.throws(
    () => runner.prepare(fakeProfile, { text: 'x'.repeat(100) }),
    (e) => e.status === 413 && e.code === 'INPUT_TOO_LARGE',
  );
});

test('prepare는 출처·URL 허용 집합·품질 기준·기본 meta를 돌려준다', () => {
  const { runner } = makeRunner();
  const p = runner.prepare(fakeProfile, { text: 'abc' });

  assert.deepEqual(p.normalized, { text: 'abc' });
  assert.deepEqual(p.sources.map((s) => s.sourceId), ['S1']);
  assert.ok(p.urlWhitelist.has('https://a.com/1'));
  assert.ok(p.qualityContext.sources.has('S1'));
  assert.deepEqual(p.baseMeta, {
    collectedAt: p.collectedAt, sourceCount: 1, duplicatesRemoved: 0,
    estimatedInputTokens: p.estimatedInputTokens,
  });
});

test('issueConfirmToken은 cacheKey와 세션에 묶인 토큰을 저장한다', () => {
  const { runner, config, clock, confirmTokens } = makeRunner();
  const t = runner.issueConfirmToken('key-1', 'session-1');

  assert.match(t.confirmToken, /^ct_[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(confirmTokens.get(t.confirmToken), { cacheKey: 'key-1', sessionToken: 'session-1' });
  assert.equal(t.confirmTokenExpiresAt, new Date(clock.now() + config.confirmTokenTtlMs).toISOString());
});

test('mock LLM은 jsonSchema 이름으로 보고서를 고른다', async () => {
  const mock = createMockLlmClient({ fake_schema: { summary: '가짜 요약' } });

  const custom = await mock.complete({ useJsonSchema: true, jsonSchema: { name: 'fake_schema' } });
  assert.deepEqual(JSON.parse(custom.content), { summary: '가짜 요약' });

  const markdown = await mock.complete({ useJsonSchema: false, jsonSchema: { name: 'fake_schema' } });
  assert.ok(markdown.content.includes('가짜 요약'));

  const invest = await mock.complete({ useJsonSchema: true, jsonSchema: ANALYSIS_JSON_SCHEMA });
  assert.ok(Array.isArray(JSON.parse(invest.content).newsBriefing));

  // 프로토타입 키로 엉뚱한 값을 고르지 않는다.
  const proto = await mock.complete({ useJsonSchema: true, jsonSchema: { name: 'constructor' } });
  assert.ok(Array.isArray(JSON.parse(proto.content).newsBriefing));
});

test('투자 분석은 LLM에 투자 응답 스키마를 넘긴다', async () => {
  const base = createMockLlmClient();
  const llm = makeMockLlm((req) => base.complete(req));
  const { app } = bootstrap({ clock: makeClock(), llm });
  const token = (await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD })).body.token;
  const payload = {
    newsList: [{
      title: '엔비디아 실적', content: '데이터센터 매출이 늘었다.', source: '연합뉴스',
      url: 'https://example.com/a/1', publishedAt: '2026-08-30T09:00:00Z',
    }],
  };

  const est = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send(payload);
  const res = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`).set('X-Confirm-Token', est.body.confirmToken).send(payload);

  assert.equal(res.status, 200);
  assert.equal(llm.calls[0].jsonSchema, ANALYSIS_JSON_SCHEMA);
});
