// ─── CS 기술 동향 브리핑 응답 형식 ───

import { strObj, str, strArray } from './schema-helpers.js';

/** 근거 수준. 순서는 강한 근거부터다. 품질 검사와 화면이 같은 값을 쓴다. */
export const EVIDENCE_LEVELS = Object.freeze([
  '동료 심사 논문', '프리프린트', '공식 발표·블로그', '코드 공개', '커뮤니티 화제', '언론 보도',
]);
export const EVIDENCE = Object.freeze({
  PEER_REVIEWED: '동료 심사 논문',
  PREPRINT: '프리프린트',
  CODE: '코드 공개',
});
export const COVERAGE_LEVELS = Object.freeze(['충분', '부분적', '부족']);

export const CS_JSON_SCHEMA = {
  name: 'cs_trend_briefing',
  strict: true,
  schema: strObj({
    summary: str(),
    keyDevelopments: {
      type: 'array',
      items: strObj({
        title: str(),
        whatIsNew: str(),
        whyItMatters: str(),
        evidenceLevel: { type: 'string', enum: [...EVIDENCE_LEVELS] },
        sourceIds: strArray(),
      }),
    },
    paperHighlights: {
      type: 'array',
      items: strObj({ sourceId: str(), contribution: str(), method: str(), limitations: str() }),
    },
    communityPulse: str(),
    openSourceSignals: {
      type: 'array',
      items: strObj({ sourceId: str(), signal: str() }),
    },
    developerPainPoints: {
      type: 'array',
      items: strObj({ title: str(), detail: str(), sourceIds: strArray() }),
    },
    openQuestions: strArray(),
    whatToWatch: strArray(),
    sourceCoverage: strObj({
      level: { type: 'string', enum: [...COVERAGE_LEVELS] },
      note: str(),
    }),
  }),
};

/** LLM_MODE=mock 응답. P1만 인용한다. CS 요청은 자료가 3건 이상이라 테스트 본문에 P1을 둔다. */
export const CS_MOCK_REPORT = Object.freeze({
  summary: '[MOCK] 제공된 자료를 기반으로 한 CS 동향 요약입니다. 실제 분석이 아닙니다.',
  keyDevelopments: [{
    title: '[MOCK] 주요 동향',
    whatIsNew: '[MOCK] 새로운 점',
    whyItMatters: '[MOCK] 중요한 이유',
    evidenceLevel: '프리프린트',
    sourceIds: ['P1'],
  }],
  paperHighlights: [{
    sourceId: 'P1',
    contribution: '[MOCK] 기여',
    method: '[MOCK] 방법',
    limitations: '초록에 한계가 명시되지 않음',
  }],
  communityPulse: '[MOCK] 커뮤니티 반응',
  openSourceSignals: [],
  developerPainPoints: [],
  openQuestions: ['[MOCK] 미해결 질문'],
  whatToWatch: ['[MOCK] 지켜볼 것'],
  sourceCoverage: { level: '부분적', note: '[MOCK] 자료 범위 설명' },
});
