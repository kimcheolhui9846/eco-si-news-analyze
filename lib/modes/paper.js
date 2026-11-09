import { ApiError } from '../errors.js';
import { buildPaperAnalyzeSchema } from '../validation.js';
import { PAPER_CHECKS, buildPaperQualityContext } from '../quality/paper.js';
import { PAPER_SYSTEM_PROMPT, buildPaperUserPrompt } from './paper-prompt.js';
import { PAPER_JSON_SCHEMA, PAPER_MOCK_REPORT } from './paper-schema.js';

// ─── 논문 한 편 전문 분석 프로필 ───
// 출처는 논문의 장이다. 장 ID(S0 초록, S1…)는 수집 때 파서가 붙인 그대로 쓴다.

const anchorUrl = (paper, s) => `${paper.htmlUrl}#${s.anchor}`;

export const paperProfile = Object.freeze({
  mode: 'paper',
  buildAnalyzeSchema: buildPaperAnalyzeSchema,
  systemPrompt: PAPER_SYSTEM_PROMPT,
  jsonSchema: PAPER_JSON_SCHEMA,
  checks: PAPER_CHECKS,
  mockReport: PAPER_MOCK_REPORT,

  normalize({ paper }) {
    if (!paper.sections.some((s) => s.id !== 'S0')) {
      throw new ApiError(422, 'INSUFFICIENT_DATA', '본문 장이 없어 전문 분석을 할 수 없습니다.');
    }
    return { paper, sections: paper.sections, truncated: paper.truncated, total: paper.sections.length };
  },

  buildUserPrompt: (n, { collectedAt }) => buildPaperUserPrompt(n, { collectedAt }),

  // 모드가 다르면 같은 자료라도 다른 보고서다. 확인 토큰이 모드를 넘나들지 못한다.
  hashInput: (n) => ({ mode: 'paper', paper: n.paper }),

  buildSources(n, collectedAt) {
    return n.sections.map((s) => ({
      sourceId: s.id,
      title: s.heading,
      source: `arXiv ${n.paper.id}`,
      url: anchorUrl(n.paper, s),
      publishedAt: null,
      collectedAt,
      type: 'section',
      relevance: 0,
    }));
  },

  urlWhitelist(n) {
    const urls = new Set([n.paper.url, n.paper.htmlUrl]);
    for (const s of n.sections) urls.add(anchorUrl(n.paper, s));
    return urls;
  },

  qualityContext: (n, sources) => buildPaperQualityContext({ sources, sections: n.sections, truncated: n.truncated }),

  baseMeta: (n) => ({
    sourceCount: n.total,
    duplicatesRemoved: 0,
    paper: { id: n.paper.id, title: n.paper.title },
    truncated: n.truncated,
  }),
});
