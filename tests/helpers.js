import { createApp } from '../server.js';

export const TEST_PASSWORD = 'test-password-1234';

/** 수동으로 시간을 앞으로 돌릴 수 있는 시계. 세션 만료 테스트의 핵심. */
export function makeClock(startMs = 1_700_000_000_000) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms) => { current += ms; },
    set: (ms) => { current = ms; },
  };
}

/** 호출 기록을 남기는 mock LLM. handler는 요청마다 응답을 만들거나 throw한다. */
export function makeMockLlm(handler) {
  const calls = [];
  return {
    calls,
    async complete(request) {
      calls.push(request);
      return handler(request, calls.length);
    },
  };
}

export const BASE_ENV = {
  MY_SECRET_PASSWORD: TEST_PASSWORD,
  LLM_MODE: 'mock',
  NODE_ENV: 'test',
  // 빈 값이면 영속화하지 않는다. 테스트가 실제 .budget.json을 오염시키면 안 된다.
  BUDGET_FILE: '',
};

export function bootstrap({ env = {}, clock, llm, http, extraRoutes, directory } = {}) {
  return createApp({ env: { ...BASE_ENV, ...env }, clock, llm, http, extraRoutes, directory });
}

/**
 * 수집 응답 → 분석 요청 본문. 클라이언트(client/src/api/client.js)와 같은 규칙이다.
 * 이 규칙이 cacheKey 계약이다. lib/instruments.js의 toAnalysisInstruments를 import하지
 * 않는다 — 서버 구현과 독립된 대조 기준(oracle)이어야 어긋남을 잡을 수 있다.
 */
export function analysisBody(c) {
  const body = { newsList: c.newsList };
  const instruments = (c.instruments ?? [])
    .filter((i) => i.marketData || i.financial)
    .map(({ series, ...rest }) => rest);
  if (instruments.length) body.instruments = instruments;
  if (c.collected?.resolution?.sector) body.sector = c.collected.resolution.sector;
  if (c.research?.length) body.research = c.research;
  if (c.experiments?.length) body.experiments = c.experiments;
  return body;
}
