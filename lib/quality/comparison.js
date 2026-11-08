import { issue } from './walk.js';

// ─── 종목 비교 검사 ───

export function checkComparison(analysis, { instruments }) {
  const list = analysis.instrumentComparison;
  const many = instruments.length > 1;

  if (!Array.isArray(list)) {
    return {
      analysis,
      issues: many ? [issue('comparison', 'warning', '여러 종목을 분석했는데 종목 비교가 없습니다.', 'instrumentComparison')] : [],
    };
  }

  if (!many) {
    if (list.length === 0) return { analysis, issues: [] };
    return {
      analysis: { ...analysis, instrumentComparison: [] },
      issues: [issue('comparison', 'fixed', '비교할 종목이 하나뿐이어서 종목 비교를 비웠습니다.', 'instrumentComparison')],
    };
  }

  const issues = [];
  const bySymbol = new Map(instruments.map((i) => [i.symbol, i]));
  const seen = new Set();
  const kept = [];
  list.forEach((entry, i) => {
    const inst = bySymbol.get(entry?.symbol);
    if (!inst) {
      issues.push(issue('comparison', 'fixed', '제공되지 않은 종목의 비교 항목을 제거했습니다.', `instrumentComparison[${i}]`));
      return;
    }
    if (seen.has(inst.symbol)) {
      issues.push(issue('comparison', 'fixed', `${inst.symbol} 비교 항목이 중복되어 첫 항목만 남겼습니다.`, `instrumentComparison[${i}]`));
      return;
    }
    seen.add(inst.symbol);
    kept.push({ ...entry, name: inst.name });
  });

  const missing = instruments.filter((i) => !seen.has(i.symbol)).map((i) => i.symbol);
  if (missing.length > 0) {
    issues.push(issue('comparison', 'warning', `종목 비교에서 빠진 종목이 있습니다: ${missing.join(', ')}`, 'instrumentComparison'));
  }
  return { analysis: { ...analysis, instrumentComparison: kept }, issues };
}
