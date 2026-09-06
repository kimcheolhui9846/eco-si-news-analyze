import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCircuitBreaker, createMockLlmClient, callWithResilience,
  ANALYSIS_JSON_SCHEMA, loadConfig, ApiError,
} from '../server.js';
import { makeClock, makeMockLlm, BASE_ENV } from './helpers.js';

const cfg = (over = {}) => loadConfig({ ...BASE_ENV, ...over });

// ─── 회로 차단기 ───

test('연속 실패가 임계치에 도달하면 회로를 연다', () => {
  const clock = makeClock();
  const breaker = createCircuitBreaker({ threshold: 3, cooldownMs: 1000, clock });

  assert.equal(breaker.canPass(), true);
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.canPass(), true, '임계치 전에 열렸다');
  breaker.recordFailure();
  assert.equal(breaker.canPass(), false, '임계치에서 열리지 않았다');
  assert.equal(breaker.state(), 'open');
});

test('성공하면 실패 카운터가 초기화된다', () => {
  const breaker = createCircuitBreaker({ threshold: 3, cooldownMs: 1000, clock: makeClock() });
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordSuccess();
  breaker.recordFailure();
  breaker.recordFailure();

  assert.equal(breaker.canPass(), true, '성공 후 카운터가 초기화되지 않았다');
});

test('쿨다운이 지나면 half-open으로 한 번 시도를 허용한다', () => {
  const clock = makeClock();
  const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 1000, clock });
  breaker.recordFailure();
  assert.equal(breaker.canPass(), false);

  clock.advance(1001);
  assert.equal(breaker.canPass(), true, '쿨다운 후에도 막혀 있다');
  assert.equal(breaker.state(), 'half-open');
});

test('half-open에서 실패하면 다시 닫힌다', () => {
  const clock = makeClock();
  const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 1000, clock });
  breaker.recordFailure();
  clock.advance(1001);
  breaker.canPass();
  breaker.recordFailure();

  assert.equal(breaker.canPass(), false);
});

test('half-open에서 성공하면 회로가 완전히 닫힌다', () => {
  const clock = makeClock();
  const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 1000, clock });
  breaker.recordFailure();
  clock.advance(1001);
  breaker.canPass();
  breaker.recordSuccess();

  assert.equal(breaker.state(), 'closed');
  assert.equal(breaker.canPass(), true);
});

// ─── 재시도와 백오프 ───

test('일시적 실패 후 재시도해서 성공한다', async () => {
  const clock = makeClock();
  const breaker = createCircuitBreaker({ threshold: 5, cooldownMs: 1000, clock });
  const llm = makeMockLlm((req, n) => {
    if (n === 1) throw new Error('일시적 오류');
    return { content: '{"ok":true}', model: 'test' };
  });

  const result = await callWithResilience(llm, { system: 's', user: 'u' }, {
    config: cfg({ OPENAI_MAX_RETRIES: '2' }), breaker, clock, sleep: async () => {},
  });

  assert.equal(result.content, '{"ok":true}');
  assert.equal(llm.calls.length, 2);
});

test('재시도 횟수를 넘기면 UPSTREAM_ERROR를 던진다', async () => {
  const clock = makeClock();
  const breaker = createCircuitBreaker({ threshold: 99, cooldownMs: 1000, clock });
  const llm = makeMockLlm(() => { throw new Error('계속 실패'); });

  await assert.rejects(
    () => callWithResilience(llm, { system: 's', user: 'u' }, {
      config: cfg({ OPENAI_MAX_RETRIES: '2' }), breaker, clock, sleep: async () => {},
    }),
    (err) => err instanceof ApiError && err.code === 'UPSTREAM_ERROR' && err.status === 502,
  );

  // 최초 1회 + 재시도 2회
  assert.equal(llm.calls.length, 3);
});

test('타임아웃은 UPSTREAM_TIMEOUT 504로 변환된다', async () => {
  const clock = makeClock();
  const breaker = createCircuitBreaker({ threshold: 99, cooldownMs: 1000, clock });
  const llm = makeMockLlm(() => {
    const err = new Error('시간 초과');
    err.name = 'AbortError';
    throw err;
  });

  await assert.rejects(
    () => callWithResilience(llm, { system: 's', user: 'u' }, {
      config: cfg({ OPENAI_MAX_RETRIES: '0' }), breaker, clock, sleep: async () => {},
    }),
    (err) => err instanceof ApiError && err.code === 'UPSTREAM_TIMEOUT' && err.status === 504,
  );
});

test('백오프 대기 시간이 지수적으로 늘어난다', async () => {
  const clock = makeClock();
  const breaker = createCircuitBreaker({ threshold: 99, cooldownMs: 1000, clock });
  const waits = [];
  const llm = makeMockLlm(() => { throw new Error('실패'); });

  await assert.rejects(() => callWithResilience(llm, { system: 's', user: 'u' }, {
    config: cfg({ OPENAI_MAX_RETRIES: '3' }), breaker, clock,
    sleep: async (ms) => { waits.push(ms); },
  }));

  assert.equal(waits.length, 3);
  assert.ok(waits[1] > waits[0], `백오프가 늘지 않았다: ${waits}`);
  assert.ok(waits[2] > waits[1], `백오프가 늘지 않았다: ${waits}`);
});

test('회로가 열려 있으면 호출하지 않고 CIRCUIT_OPEN을 던진다', async () => {
  const clock = makeClock();
  const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 60_000, clock });
  breaker.recordFailure();

  const llm = makeMockLlm(() => ({ content: '{}', model: 'test' }));

  await assert.rejects(
    () => callWithResilience(llm, { system: 's', user: 'u' }, {
      config: cfg(), breaker, clock, sleep: async () => {},
    }),
    (err) => err instanceof ApiError && err.code === 'CIRCUIT_OPEN' && err.status === 503,
  );

  assert.equal(llm.calls.length, 0, '회로가 열렸는데 상류를 호출했다');
});

// ─── JSON 스키마 ───

test('strict 스키마는 모든 속성을 required로 두고 additionalProperties를 막는다', () => {
  // OpenAI strict 모드의 요구사항이다. 하나라도 어기면 400을 돌려받는다.
  const walk = (node, path = 'root') => {
    if (node?.type === 'array') { walk(node.items, `${path}[]`); return; }
    if (node?.type !== 'object') return;

    assert.equal(node.additionalProperties, false, `${path}에 additionalProperties:false가 없다`);
    const props = Object.keys(node.properties ?? {});
    assert.deepEqual([...(node.required ?? [])].sort(), props.sort(),
      `${path}의 required가 속성 전체와 다르다`);
    for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, `${path}.${key}`);
  };

  walk(ANALYSIS_JSON_SCHEMA.schema);
});

test('스키마에 sources가 없다', () => {
  // 출처 목록은 서버가 만든다. LLM이 관여하면 위조가 가능해진다.
  assert.equal('sources' in ANALYSIS_JSON_SCHEMA.schema.properties, false);
});

// ─── mock 클라이언트 ───

test('mock 클라이언트는 스키마를 만족하는 결정적 응답을 준다', async () => {
  const llm = createMockLlmClient();
  const a = await llm.complete({ system: 's', user: 'u', useJsonSchema: true });
  const b = await llm.complete({ system: 's', user: 'u', useJsonSchema: true });

  assert.equal(a.content, b.content, 'mock 응답이 결정적이지 않다');

  const parsed = JSON.parse(a.content);
  for (const key of Object.keys(ANALYSIS_JSON_SCHEMA.schema.properties)) {
    assert.ok(key in parsed, `mock 응답에 ${key}가 없다`);
  }
});

// ─── Phase 2b 요약 필드 ───

test('응답 스키마에 Phase 2b 요약 필드 3개가 있다', () => {
  const props = ANALYSIS_JSON_SCHEMA.schema.properties;
  for (const key of ['financialSummary', 'researchSummary', 'experimentSummary']) {
    assert.ok(props[key], `${key}가 없다`);
    assert.equal(props[key].additionalProperties, false);
  }
});

test('available이 열거형이라 근거 없는 서술을 막는다', () => {
  // 자유 문자열이면 "재무지표가 양호합니다" 같은 서술이 나온다.
  const props = ANALYSIS_JSON_SCHEMA.schema.properties;
  for (const key of ['financialSummary', 'researchSummary', 'experimentSummary']) {
    assert.deepEqual(props[key].properties.available.enum, ['자료 있음', '자료 부족']);
  }
});

test('strict 모드 규칙대로 새 필드도 required에 있다', () => {
  const schema = ANALYSIS_JSON_SCHEMA.schema;
  for (const key of ['financialSummary', 'researchSummary', 'experimentSummary']) {
    assert.ok(schema.required.includes(key));
    assert.deepEqual(
      schema.properties[key].required.slice().sort(),
      Object.keys(schema.properties[key].properties).sort(),
    );
  }
});
