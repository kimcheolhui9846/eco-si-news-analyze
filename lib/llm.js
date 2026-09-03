import OpenAI from 'openai';

import { ApiError } from './errors.js';

// ─── 응답 스키마 ───

const strObj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),   // strict 모드는 전 속성이 required여야 한다
  additionalProperties: false,
});

export const ANALYSIS_JSON_SCHEMA = {
  name: 'investment_analysis_report',
  strict: true,
  schema: strObj({
    summary: { type: 'string' },
    newsBriefing: {
      type: 'array',
      items: strObj({
        sourceId: { type: 'string' },
        title: { type: 'string' },
        source: { type: 'string' },
        publishedAt: { type: 'string' },
        keyPoints: { type: 'string' },
        marketImplication: { type: 'string' },
        needsVerification: { type: 'string' },
      }),
    },
    trendAnalysis: { type: 'string' },
    scenarios: {
      type: 'array',
      items: strObj({
        type: { type: 'string' },
        premise: { type: 'string' },
        indicatorsToWatch: { type: 'string' },
        possibleDirection: { type: 'string' },
        invalidationCondition: { type: 'string' },
        cautions: { type: 'string' },
      }),
    },
    risks: { type: 'array', items: { type: 'string' } },
    monitoringIndicators: { type: 'array', items: { type: 'string' } },
    disclaimer: { type: 'string' },
  }),
};

// ─── 회로 차단기 ───

export function createCircuitBreaker({ threshold, cooldownMs, clock }) {
  let failures = 0;
  let openedAt = null;
  let halfOpen = false;

  return {
    canPass() {
      if (openedAt === null) return true;
      if (clock.now() - openedAt < cooldownMs) return false;
      // 쿨다운이 끝났다. 한 번만 통과시켜 상류가 살아났는지 본다.
      halfOpen = true;
      return true;
    },

    recordSuccess() {
      failures = 0;
      openedAt = null;
      halfOpen = false;
    },

    recordFailure() {
      if (halfOpen) {
        // 시험 호출이 실패했다. 쿨다운을 다시 시작한다.
        halfOpen = false;
        openedAt = clock.now();
        return;
      }
      failures += 1;
      if (failures >= threshold) openedAt = clock.now();
    },

    state() {
      if (openedAt === null) return 'closed';
      return halfOpen ? 'half-open' : 'open';
    },
  };
}

// ─── LLM 클라이언트 ───

export function createLlmClient(config) {
  const client = new OpenAI({
    apiKey: config.openaiApiKey,
    timeout: config.openaiTimeoutMs,
    maxRetries: 0,   // 재시도는 callWithResilience가 관리한다. 이중 재시도를 막는다.
  });

  return {
    async complete({ system, user, useJsonSchema }) {
      const response = await client.chat.completions.create({
        model: config.openaiModel,
        messages: [
          { role: 'system', content: system },   // 항상 첫 메시지. 사용자 입력이 올 수 없다.
          { role: 'user', content: user },
        ],
        ...(useJsonSchema
          ? { response_format: { type: 'json_schema', json_schema: ANALYSIS_JSON_SCHEMA } }
          : {}),
      });

      return {
        content: response.choices[0]?.message?.content ?? '',
        model: response.model,
      };
    },
  };
}

/** 실제 API 키 없이 전체 파이프라인을 검증하기 위한 결정적 mock. */
export function createMockLlmClient() {
  const scenario = (type) => ({
    type,
    premise: '[MOCK] 전제 조건',
    indicatorsToWatch: '[MOCK] 확인해야 할 지표',
    possibleDirection: '[MOCK] 가능성 있는 방향',
    invalidationCondition: '[MOCK] 무효화 조건',
    cautions: '[MOCK] 투자자가 주의할 점',
  });

  const report = {
    summary: '[MOCK] 제공된 자료를 기반으로 한 요약입니다. 실제 분석이 아닙니다.',
    newsBriefing: [{
      sourceId: 'S1',
      title: '[MOCK] 기사 제목',
      source: '[MOCK] 출처',
      publishedAt: '2026-01-01T00:00:00.000Z',
      keyPoints: '[MOCK] 핵심 내용',
      marketImplication: '[MOCK] 시장 또는 기술적 의미',
      needsVerification: '[MOCK] 확인이 필요한 사항',
    }],
    trendAnalysis: '[MOCK] 차트와 뉴스의 동향 비교 분석입니다.',
    scenarios: [scenario('기본 시나리오'), scenario('부정 시나리오')],
    risks: ['[MOCK] 핵심 리스크'],
    monitoringIndicators: ['[MOCK] 모니터링 지표'],
    disclaimer: '본 분석은 제공된 자료를 기반으로 한 정보 제공 목적의 분석이며, 특정 금융상품의 매수·매도 또는 투자 수익을 보장하는 투자 권유가 아닙니다.',
  };

  const serialized = JSON.stringify(report);

  return {
    async complete({ useJsonSchema }) {
      return {
        content: useJsonSchema ? serialized : `# [MOCK] 분석 보고서\n\n${report.summary}`,
        model: 'mock',
      };
    },
  };
}

// ─── 타임아웃·재시도·백오프·차단기를 묶은 호출부 ───

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });

function classifyLlmError(err) {
  const name = err?.name ?? '';
  const status = err?.status;
  if (name === 'AbortError' || name === 'TimeoutError' || status === 408) {
    return new ApiError(504, 'UPSTREAM_TIMEOUT', '분석 서버 응답이 지연되었습니다. 잠시 후 다시 시도해 주세요.');
  }
  // 상류의 원본 메시지는 사용자에게 전달하지 않는다. 키나 내부 경로가 섞일 수 있다.
  return new ApiError(502, 'UPSTREAM_ERROR', '분석 서버 호출에 실패했습니다.');
}

export async function callWithResilience(llm, req, {
  config, breaker, clock, sleep = defaultSleep, log,
}) {
  if (!breaker.canPass()) {
    throw new ApiError(503, 'CIRCUIT_OPEN', '분석 서비스가 일시적으로 중단되었습니다. 잠시 후 다시 시도해 주세요.');
  }

  const maxAttempts = config.openaiMaxRetries + 1;
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await llm.complete(req);
      breaker.recordSuccess();
      return result;
    } catch (err) {
      lastError = err;
      breaker.recordFailure();
      log?.warn({ attempt: attempt + 1, errName: err?.name }, 'LLM 호출 실패');

      if (attempt < maxAttempts - 1) {
        // 지수 백오프 + 지터. 지터가 없으면 재시도가 동시에 몰린다.
        const backoff = 500 * 2 ** attempt;
        await sleep(backoff + Math.floor(Math.random() * 250));
      }
    }
  }

  throw classifyLlmError(lastError);
}
