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
};

export function bootstrap({ env = {}, clock, llm, extraRoutes } = {}) {
  return createApp({ env: { ...BASE_ENV, ...env }, clock, llm, extraRoutes });
}
