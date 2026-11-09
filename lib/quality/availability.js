import { issue } from './walk.js';

// ─── 자료 유무 검사 ───
//
// 스키마가 available을 열거형으로 막아도, 자료가 없는데 '자료 있음'을 고르는 것은 막지 못한다.

export const NO_DATA_NOTE = '제공된 자료가 없습니다.';

const SUMMARIES = [
  { key: 'financialSummary', has: 'financial', basis: 'periodBasis', label: '재무' },
  { key: 'researchSummary', has: 'research', basis: 'maturity', label: '논문' },
  { key: 'experimentSummary', has: 'experiments', basis: 'evidenceLevel', label: '실험' },
];

export function checkAvailability(analysis, { has }) {
  const issues = [];
  const next = { ...analysis };
  for (const s of SUMMARIES) {
    const summary = analysis[s.key];
    if (!summary || typeof summary !== 'object') continue;
    const provided = Boolean(has?.[s.has]);
    if (!provided && summary.available === '자료 있음') {
      next[s.key] = { ...summary, available: '자료 부족', [s.basis]: '자료 부족', notes: NO_DATA_NOTE };
      issues.push(issue('availability', 'fixed',
        `${s.label} 자료가 제공되지 않았는데 '자료 있음'으로 쓰여 '자료 부족'으로 바로잡았습니다.`, `${s.key}.available`));
    } else if (provided && summary.available === '자료 부족') {
      issues.push(issue('availability', 'warning',
        `${s.label} 자료가 제공됐는데 분석에서 '자료 부족'으로 처리했습니다.`, `${s.key}.available`));
    }
  }
  return { analysis: next, issues };
}
