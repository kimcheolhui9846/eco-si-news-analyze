import { issue } from './walk.js';
import { checkCitations, replaceUnknownIds } from './citations.js';
import { checkAvailability } from './availability.js';
import { checkDisclaimer } from './disclaimer.js';
import { checkScenarios } from './scenarios.js';
import { checkComparison } from './comparison.js';

// ─── 분석 품질 게이트 ───
//
// LLM 응답 뒤에서 결정적으로 교정·경고한다. LLM을 다시 부르지 않는다.

export const CHECK_ERROR_MESSAGE = '자동 검사 중 오류가 나서 이 항목은 검증하지 못했습니다.';
export const LIMITED_MESSAGE = '구조화 응답이 아니어서 검증이 제한되었습니다.';

/** 순서가 계약이다. 인용을 먼저 고쳐야 뒤 검사가 고친 값을 본다. */
export const CHECKS = [
  ['citations', checkCitations],
  ['availability', checkAvailability],
  ['disclaimer', checkDisclaimer],
  ['scenarios', checkScenarios],
  ['comparison', checkComparison],
];

/** 서버가 이미 만든 출처 목록과 종목으로 검사 기준을 만든다. */
export function buildQualityContext({ sources = [], instruments = [], sector } = {}) {
  return {
    sources: new Map(sources.map((s) => [s.sourceId, { title: s.title, source: s.source, publishedAt: s.publishedAt }])),
    instruments: (instruments ?? []).filter((i) => i.marketData).map(({ symbol, name }) => ({ symbol, name })),
    sector,
    idPrefixes: 'SPTFM',
    has: {
      financial: sources.some((s) => s.type === 'financial'),
      research: sources.some((s) => s.type === 'research'),
      experiments: sources.some((s) => s.type === 'experiment'),
    },
  };
}

function summarize(issues, limited) {
  const fixed = issues.filter((i) => i.severity === 'fixed').length;
  const warnings = issues.length - fixed;
  return { score: Math.max(0, 100 - 10 * fixed - 5 * warnings), fixed, warnings, issues, limited };
}

export function assessQuality(analysis, context, { degraded = false, checks = CHECKS } = {}) {
  const issues = [];

  if (degraded) {
    let current = analysis;
    if (typeof analysis?.report === 'string') {
      const { text, changed } = replaceUnknownIds(analysis.report, new Set(context.sources.keys()), context.idPrefixes);
      if (changed) {
        issues.push(issue('citations', 'fixed', '제공되지 않은 출처 ID 인용을 "출처 미확인"으로 바꿨습니다.', 'report'));
      }
      current = { ...analysis, report: text };
    }
    issues.push(issue('structure', 'warning', LIMITED_MESSAGE, ''));
    return { analysis: current, quality: summarize(issues, true) };
  }

  let current = analysis;
  for (const [name, check] of checks) {
    try {
      const result = check(current, context);
      current = result.analysis;
      issues.push(...result.issues);
    } catch {
      issues.push(issue(name, 'warning', CHECK_ERROR_MESSAGE, ''));
    }
  }
  return { analysis: current, quality: summarize(issues, false) };
}
