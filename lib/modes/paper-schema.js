import { strObj, str, strArray } from './schema-helpers.js';

// ─── 논문 비판적 읽기 응답 형식 ───

export const SEVERITY_LEVELS = Object.freeze(['경미', '중요', '치명']);
export const AVAILABILITY_LEVELS = Object.freeze(['공개', '미공개', '언급 없음']);

const enumOf = (values) => ({ type: 'string', enum: [...values] });

export const PAPER_JSON_SCHEMA = {
  name: 'paper_critical_reading',
  strict: true,
  schema: strObj({
    summary: str(),
    problem: strObj({ statement: str(), sourceIds: strArray() }),
    method: strObj({ overview: str(), keyIdeas: strArray(), sourceIds: strArray() }),
    experimentalSetup: strObj({
      datasets: strArray(), baselines: strArray(), metrics: strArray(), sourceIds: strArray(),
    }),
    keyResults: {
      type: 'array',
      items: strObj({ claim: str(), numbers: strArray(), sourceIds: strArray() }),
    },
    authorStatedLimitations: {
      type: 'array',
      items: strObj({ point: str(), sourceIds: strArray() }),
    },
    reviewerConcerns: {
      type: 'array',
      items: strObj({ concern: str(), why: str(), severity: enumOf(SEVERITY_LEVELS), sourceIds: strArray() }),
    },
    reproducibility: strObj({
      code: enumOf(AVAILABILITY_LEVELS),
      data: enumOf(AVAILABILITY_LEVELS),
      note: str(),
      sourceIds: strArray(),
    }),
    openQuestions: strArray(),
  }),
};

/** LLM_MODE=mock 응답. S0(초록)·S1만 인용한다. 논문 요청은 본문 장이 1개 이상이라 S1이 있다. */
export const PAPER_MOCK_REPORT = Object.freeze({
  summary: '[MOCK] 논문 본문을 바탕으로 한 요약입니다. 실제 분석이 아닙니다. [S0]',
  problem: { statement: '[MOCK] 풀려는 문제', sourceIds: ['S0'] },
  method: { overview: '[MOCK] 방법 개요', keyIdeas: ['[MOCK] 핵심 아이디어'], sourceIds: ['S1'] },
  experimentalSetup: { datasets: [], baselines: [], metrics: [], sourceIds: ['S1'] },
  keyResults: [],
  authorStatedLimitations: [],
  reviewerConcerns: [{ concern: '[MOCK] 약점', why: '[MOCK] 이유', severity: '경미', sourceIds: ['S1'] }],
  reproducibility: { code: '언급 없음', data: '언급 없음', note: '[MOCK] 재현성 메모', sourceIds: ['S0'] },
  openQuestions: ['[MOCK] 남은 질문'],
});
