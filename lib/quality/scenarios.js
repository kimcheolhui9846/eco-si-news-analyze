import { mapStrings, issue } from './walk.js';

// ─── 시나리오 검사 ───
//
// 단정 표현은 정규식으로만 본다. 문장 맥락을 모르므로 고치지 않고 경고만 한다.

const DIRECTION = '(상승|하락|오르|내리|오른|내린|오를|내릴|급등|급락)';
// "반드시 상승하지는 않는다"처럼 부정이 뒤따르면 단정이 아니다.
const NOT_NEGATED = '(?![가-힣]*지\\s*(는|도|않|못))';

export const ASSERTIVE_PATTERNS = [
  new RegExp(`반드시\\s*${DIRECTION}${NOT_NEGATED}`),
  new RegExp(`확실히\\s*${DIRECTION}${NOT_NEGATED}`),
  /(상승|하락|급등|급락)할\s*것이\s*(확실|분명)/,
  // 통화 단위가 붙어야 가격이다. "성장 목표가 3가지"는 가격이 아니다.
  /목표\s*(주가|가격|가)\s*(은|는|를|가|:)?\s*[\d,.]+\s*(원|달러|USD|KRW|\$)/,
  /(매수|매도)\s*(을|를)?\s*(추천|권유|권고)(합니다|드립니다|해요|한다|드린다)/,
  /(매수|매도)\s*(하세요|하십시오|해야\s*(한다|합니다))/,
  // 과거 수익률 서술("작년에 100% 상승했다")은 예측이 아니다. 수익 보장 표현만 본다.
  /(?<![\d,.])100\s*%\s*(수익|보장|확실)/,
];

const EMPTY_INVALIDATION = /^\s*(자료\s*부족|해당\s*없음|없음|n\/?a|-)?\s*[.。]?\s*$/i;

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
