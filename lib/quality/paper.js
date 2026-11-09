import { issue } from './walk.js';
import { checkCitations } from './citations.js';
import { checkInvestmentLanguage } from './cs.js';

// ─── 논문 비판적 읽기 품질 검사 ───
//
// 규약은 투자·CS와 같다: (analysis, context) → { analysis, issues }. 입력은 바꾸지 않는다.
// 모델이 쓴 값(수치·ID 원문)은 메시지에 옮기지 않는다. 개수와 경로만 남긴다.

export const PAPER_ID_PREFIXES = 'S';
// 이 낱말이 장 제목에 있으면 결과를 정리해야 할 본문이 있다고 본다.
export const RESULT_HEADING = /experiment|evaluation|result|benchmark/i;

/** 쉼표 천 단위와 유니코드 마이너스를 맞춘다. 본문과 수치 양쪽에 같은 규칙을 쓴다. */
export function normalizeNumberText(text) {
  return String(text ?? '')
    .replace(/\u2212/g, '-')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
}

/** 수치 하나를 비교용으로. 수식 표시($)와 끝의 %·×·x를 뗀다. */
export function normalizeNumber(value) {
  return normalizeNumberText(String(value ?? '').trim())
    .replace(/^\$|\$$/g, '')
    .replace(/(\d)\s*(%|×|x|X)$/, '$1')
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 순수한 수치는 숫자 경계로 찾는다: 85.3이 185.3이나 85.31에 걸리지 않고, 85가 85.3에 걸리지 않는다.
 * 단위가 붙은 값('14.1 points')은 정규화한 뒤 대소문자 무시 부분 문자열로 찾는다.
 */
export function numberAppears(value, normalizedText) {
  const v = normalizeNumber(value);
  if (!v) return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    return new RegExp(`(?<![\\d.])${escapeRe(v)}(?!\\.?\\d)`).test(normalizedText);
  }
  return normalizedText.toLowerCase().includes(v.toLowerCase());
}

/** 서버가 만든 출처(장) 목록과 분석에 실린 장 본문으로 검사 기준을 만든다. eval 러너도 이 함수를 쓴다. */
export function buildPaperQualityContext({ sources = [], sections = [], truncated = [] } = {}) {
  return {
    sources: new Map(sources.map((s) => [s.sourceId, {
      title: s.title, source: s.source, publishedAt: s.publishedAt, type: s.type,
    }])),
    sectionText: new Map(sections.map((s) => [s.id, normalizeNumberText(s.text)])),
    headings: sections.map((s) => s.heading),
    truncated,
    idPrefixes: PAPER_ID_PREFIXES,
  };
}

const OBJECT_FIELDS = { problem: '문제 정의', method: '방법', experimentalSetup: '실험 설정', reproducibility: '재현성' };
const LIST_FIELDS = { keyResults: '핵심 결과', authorStatedLimitations: '저자가 밝힌 한계', reviewerConcerns: '리뷰어 시각의 약점' };

const cleanIds = (ids, sources) => {
  const list = Array.isArray(ids) ? ids : [];
  return {
    kept: [...new Set(list.filter((id) => sources.has(id)))],
    dropped: list.filter((id) => !sources.has(id)).length,
  };
};

export function checkSectionRefs(analysis, { sources }) {
  const issues = [];
  const next = { ...analysis };

  for (const [field, label] of Object.entries(OBJECT_FIELDS)) {
    const obj = analysis[field];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    const { kept, dropped } = cleanIds(obj.sourceIds, sources);
    if (dropped > 0) {
      issues.push(issue('sectionRefs', 'fixed', `${label}에서 제공되지 않은 장 ID ${dropped}개를 뺐습니다.`, `${field}.sourceIds`));
    }
    if (kept.length === 0) {
      issues.push(issue('sectionRefs', 'warning', `${label}에 근거 장이 없습니다. 직접 확인해 주세요.`, field));
    }
    next[field] = { ...obj, sourceIds: kept };
  }

  for (const [field, label] of Object.entries(LIST_FIELDS)) {
    if (!Array.isArray(analysis[field])) continue;
    const kept = [];
    analysis[field].forEach((entry, i) => {
      const { kept: ids, dropped } = cleanIds(entry?.sourceIds, sources);
      if (ids.length === 0) {
        issues.push(issue('sectionRefs', 'fixed', `${label} 항목에 확인되는 근거 장이 없어 항목을 제거했습니다.`, `${field}[${i}]`));
        return;
      }
      if (dropped > 0) {
        issues.push(issue('sectionRefs', 'fixed', `${label}에서 제공되지 않은 장 ID ${dropped}개를 뺐습니다.`, `${field}[${i}].sourceIds`));
      }
      kept.push({ ...entry, sourceIds: ids });
    });
    next[field] = kept;
  }

  return { analysis: next, issues };
}

/** 핵심 결과의 수치를 인용한 장 본문과 대조한다. 인용 정리(sectionRefs) 뒤에 돈다. */
export function checkNumbers(analysis, { sectionText }) {
  if (!Array.isArray(analysis.keyResults)) return { analysis, issues: [] };
  const issues = [];
  const keyResults = [];

  analysis.keyResults.forEach((r, i) => {
    const numbers = Array.isArray(r?.numbers) ? r.numbers : [];
    // 수치가 없는 정성 결과는 대조할 것이 없다.
    if (numbers.length === 0) {
      keyResults.push(r);
      return;
    }
    const texts = (Array.isArray(r.sourceIds) ? r.sourceIds : []).map((id) => sectionText.get(id)).filter(Boolean);
    const found = numbers.filter((v) => texts.some((t) => numberAppears(v, t)));
    if (found.length === 0) {
      issues.push(issue('numbers', 'fixed',
        `핵심 결과의 수치 ${numbers.length}개가 인용한 장 본문에 없어 항목을 제거했습니다.`, `keyResults[${i}]`));
      return;
    }
    if (found.length < numbers.length) {
      issues.push(issue('numbers', 'fixed',
        `인용한 장 본문에 없는 수치 ${numbers.length - found.length}개를 뺐습니다.`, `keyResults[${i}].numbers`));
    }
    keyResults.push({ ...r, numbers: found });
  });

  return { analysis: { ...analysis, keyResults }, issues };
}

export function checkPaperCoverage(analysis, { truncated = [], headings = [] }) {
  const issues = [];
  if (truncated.length > 0) {
    issues.push(issue('coverage', 'warning',
      `본문 ${truncated.length}개 장이 길이 제한으로 분석에서 빠지거나 잘렸습니다.`, ''));
  }
  if (headings.some((h) => RESULT_HEADING.test(h))
    && Array.isArray(analysis.keyResults) && analysis.keyResults.length === 0) {
    issues.push(issue('coverage', 'warning', '본문에 실험·결과 장이 있는데 핵심 결과를 정리하지 않았습니다.', 'keyResults'));
  }
  if (Array.isArray(analysis.reviewerConcerns) && analysis.reviewerConcerns.length === 0) {
    issues.push(issue('coverage', 'warning', '리뷰어 시각의 약점을 정리하지 않았습니다.', 'reviewerConcerns'));
  }
  return { analysis, issues };
}

/** 순서가 계약이다. 장 인용을 먼저 정리해야 수치 대조가 정리된 인용을 본다. */
export const PAPER_CHECKS = [
  ['citations', checkCitations],
  ['sectionRefs', checkSectionRefs],
  ['numbers', checkNumbers],
  ['coverage', checkPaperCoverage],
  ['investmentLanguage', checkInvestmentLanguage],
];
