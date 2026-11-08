import { mapStrings, issue } from './walk.js';

// ─── 시나리오 검사 ───
//
// 단정 표현은 정규식으로만 본다. 문장 맥락을 모르므로 고치지 않고 경고만 한다.

export const ASSERTIVE_PATTERNS = [
  /반드시\s*(상승|하락|오른|내린|오를|내릴)/,
  /확실히\s*(상승|하락|오른|내린|오를|내릴)/,
  /(상승|하락)할\s*것이\s*(확실|분명)/,
  /목표\s*(주가|가격|가)\s*[:은는]?\s*[\d,]+/,
  /(매수|매도)\s*(을|를)?\s*(추천|권유|권고)(합니다|드립니다|해요)/,
  /(매수|매도)\s*하(세요|십시오)/,
  /100\s*%\s*(상승|하락|수익)/,
];

const EMPTY_INVALIDATION = /^\s*(자료\s*부족)?\s*$/;

export function checkScenarios(analysis) {
  const issues = [];
  if (Array.isArray(analysis.scenarios)) {
    analysis.scenarios.forEach((s, i) => {
      const v = s?.invalidationCondition;
      if (typeof v !== 'string' || EMPTY_INVALIDATION.test(v)) {
        issues.push(issue('scenarios', 'warning',
          '시나리오에 무효화 조건이 없습니다. 이 시나리오가 틀렸음을 알 수 있는 기준을 직접 확인하세요.',
          `scenarios[${i}].invalidationCondition`));
      }
    });
  }
  // 면책 문구는 고정 문구로 덮어쓰므로 검사하지 않는다.
  const { disclaimer: _ignored, ...rest } = analysis;
  mapStrings(rest, (text, path) => {
    if (ASSERTIVE_PATTERNS.some((re) => re.test(text))) {
      issues.push(issue('scenarios', 'warning',
        '단정적인 가격·방향 예측이나 매매 권유로 읽힐 수 있는 표현이 있습니다.', path));
    }
    return text;
  });
  return { analysis, issues };
}
