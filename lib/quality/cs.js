import { mapStrings, issue } from './walk.js';
import { checkCitations, safeId } from './citations.js';
import { EVIDENCE } from '../modes/cs-schema.js';

// ─── CS 브리핑 품질 검사 ───
//
// 투자 검사와 같은 규약이다: (analysis, context) → { analysis, issues }. 입력은 바꾸지 않는다.

const MIN_SUFFICIENT = 5;

/** CS 출처 ID 접두사. eval 러너도 이 값을 쓴다. */
export const CS_ID_PREFIXES = 'PHSBGQ';

/** 서버가 만든 출처 목록으로 검사 기준을 만든다. */
export function buildCsQualityContext(sources = []) {
  return {
    sources: new Map(sources.map((s) => [s.sourceId, {
      title: s.title, source: s.source, publishedAt: s.publishedAt, type: s.type,
    }])),
    total: sources.length,
    idPrefixes: CS_ID_PREFIXES,
  };
}

const LIST_PREFIX = { paperHighlights: 'P', openSourceSignals: 'G' };
const LIST_LABEL = { paperHighlights: '논문 하이라이트', openSourceSignals: '오픈소스 신호' };

export function checkSourceRefs(analysis, { sources }) {
  const issues = [];
  const next = { ...analysis };

  if (Array.isArray(analysis.keyDevelopments)) {
    next.keyDevelopments = analysis.keyDevelopments.map((dev, i) => {
      const ids = Array.isArray(dev?.sourceIds) ? dev.sourceIds : [];
      const unknown = ids.filter((id) => !sources.has(id)).length;
      // 중복은 모델의 실수일 뿐 근거가 틀린 것은 아니다. 조용히 합친다.
      const kept = [...new Set(ids.filter((id) => sources.has(id)))];
      if (unknown > 0) {
        issues.push(issue('sourceRefs', 'fixed',
          `주요 동향에서 제공되지 않은 출처 ID ${unknown}개를 뺐습니다.`, `keyDevelopments[${i}].sourceIds`));
      }
      if (kept.length === 0) {
        issues.push(issue('sourceRefs', 'warning', '근거 출처가 없는 동향입니다. 직접 확인해 주세요.', `keyDevelopments[${i}]`));
      }
      return { ...dev, sourceIds: kept };
    });
  }

  for (const field of ['paperHighlights', 'openSourceSignals']) {
    if (!Array.isArray(analysis[field])) continue;
    next[field] = analysis[field].filter((entry, i) => {
      const id = entry?.sourceId;
      const path = `${field}[${i}].sourceId`;
      if (!sources.has(id)) {
        issues.push(issue('sourceRefs', 'fixed',
          `${LIST_LABEL[field]} 항목의 출처 ID(${safeId(id)})가 제공된 출처에 없어 항목을 제거했습니다.`, path));
        return false;
      }
      // 프롬프트 규칙: 논문 하이라이트는 논문(P), 오픈소스 신호는 저장소(G)만 인용한다.
      if (!id.startsWith(LIST_PREFIX[field])) {
        issues.push(issue('sourceRefs', 'fixed',
          `${LIST_LABEL[field]} 항목의 출처 ID(${safeId(id)})는 종류가 맞지 않아 항목을 제거했습니다.`, path));
        return false;
      }
      return true;
    });
  }

  // 개발자 질문(Q)만 근거가 된다. 남는 근거가 없으면 항목째 뺀다.
  if (Array.isArray(analysis.developerPainPoints)) {
    const kept = [];
    analysis.developerPainPoints.forEach((pain, i) => {
      const ids = Array.isArray(pain?.sourceIds) ? pain.sourceIds : [];
      const valid = [...new Set(ids.filter((id) => sources.has(id) && id.startsWith('Q')))];
      const dropped = new Set(ids).size - valid.length;
      if (valid.length === 0) {
        issues.push(issue('sourceRefs', 'fixed',
          '개발자 질문 근거가 없는 막히는 지점 항목을 제거했습니다.', `developerPainPoints[${i}]`));
        return;
      }
      if (dropped > 0) {
        issues.push(issue('sourceRefs', 'fixed',
          `막히는 지점에서 개발자 질문이 아니거나 제공되지 않은 출처 ID ${dropped}개를 뺐습니다.`,
          `developerPainPoints[${i}].sourceIds`));
      }
      kept.push({ ...pain, sourceIds: valid });
    });
    next.developerPainPoints = kept;

    const hasQuestions = [...sources.values()].some((s) => s.type === 'question');
    if (hasQuestions && kept.length === 0) {
      issues.push(issue('sourceRefs', 'warning',
        '개발자 질문 자료가 있는데 막히는 지점을 정리하지 않았습니다.', 'developerPainPoints'));
    }
  }

  return { analysis: next, issues };
}

export function checkEvidence(analysis) {
  const issues = [];
  if (!Array.isArray(analysis.keyDevelopments)) return { analysis, issues };

  const keyDevelopments = analysis.keyDevelopments.map((dev, i) => {
    const ids = Array.isArray(dev?.sourceIds) ? dev.sourceIds : [];
    const path = `keyDevelopments[${i}].evidenceLevel`;
    // CS 모드의 논문(P)은 모두 arXiv 프리프린트다. 동료 심사 근거가 될 수 없다.
    if (dev?.evidenceLevel === EVIDENCE.PEER_REVIEWED && ids.length > 0 && ids.every((id) => id.startsWith('P'))) {
      issues.push(issue('evidence', 'fixed',
        "근거가 arXiv 프리프린트뿐이라 근거 수준을 '프리프린트'로 바로잡았습니다.", path));
      return { ...dev, evidenceLevel: EVIDENCE.PREPRINT };
    }
    if (dev?.evidenceLevel === EVIDENCE.CODE && !ids.some((id) => id.startsWith('G'))) {
      issues.push(issue('evidence', 'warning', "'코드 공개'로 표시됐지만 근거에 GitHub 저장소가 없습니다.", path));
    }
    return dev;
  });

  return { analysis: { ...analysis, keyDevelopments }, issues };
}

export function checkCoverage(analysis, { total }) {
  if (analysis.sourceCoverage?.level !== '충분' || total >= MIN_SUFFICIENT) return { analysis, issues: [] };
  return {
    analysis: { ...analysis, sourceCoverage: { ...analysis.sourceCoverage, level: '부족' } },
    issues: [issue('coverage', 'fixed',
      `수집 자료가 ${total}건뿐이라 자료 충분도를 '부족'으로 바로잡았습니다.`, 'sourceCoverage.level')],
  };
}

/**
 * CS 브리핑은 투자와 무관하다. 투자 표현은 경고만 한다.
 * 앞에 한글이 붙은 '주가'(외주가 등)는 다른 낱말이라 거르지 않는다.
 */
export const INVESTMENT_PATTERNS = [
  /(?<![가-힣])(매수|매도|주가)/,
  /목표\s*주가/,
  /투자\s*권유/,
];

export function checkInvestmentLanguage(analysis) {
  const issues = [];
  mapStrings(analysis, (text, path) => {
    if (INVESTMENT_PATTERNS.some((p) => p.test(text))) {
      issues.push(issue('investmentLanguage', 'warning', 'CS 브리핑에 투자 관련 표현이 있습니다.', path));
    }
    return text;
  });
  return { analysis, issues };
}

/** 순서가 계약이다. 출처 ID를 먼저 정리해야 근거 수준 검사가 정리된 ID를 본다. */
export const CS_CHECKS = [
  ['citations', checkCitations],
  ['sourceRefs', checkSourceRefs],
  ['evidence', checkEvidence],
  ['coverage', checkCoverage],
  ['investmentLanguage', checkInvestmentLanguage],
];
