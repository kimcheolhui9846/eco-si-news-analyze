import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkScenarios } from '../lib/quality/scenarios.js';

const scenario = (over = {}) => ({
  type: '기본', premise: '전제', indicatorsToWatch: '지표', possibleDirection: '방향',
  invalidationCondition: '분기 매출이 감소하면 무효', cautions: '주의', ...over,
});

test('무효화 조건이 비었거나 자료 부족이면 경고한다', () => {
  const { analysis, issues } = checkScenarios({
    scenarios: [scenario(), scenario({ invalidationCondition: '  ' }), scenario({ invalidationCondition: '자료 부족' }), scenario({ invalidationCondition: undefined })],
  });
  assert.deepEqual(issues.map((i) => i.path), [
    'scenarios[1].invalidationCondition', 'scenarios[2].invalidationCondition', 'scenarios[3].invalidationCondition',
  ]);
  assert.ok(issues.every((i) => i.check === 'scenarios' && i.severity === 'warning'));
  assert.equal(analysis.scenarios.length, 4, '고치지 않는다');
});

test('무효화 조건이 사실상 비어 있으면 경고한다', () => {
  for (const v of ['자료 부족.', '해당 없음', '-', 'N/A']) {
    const { issues } = checkScenarios({ scenarios: [scenario({ invalidationCondition: v })] });
    assert.equal(issues.length, 1, v);
    assert.equal(issues[0].path, 'scenarios[0].invalidationCondition', v);
  }
});

test('단정 표현은 경로당 한 건 경고한다', () => {
  const assertive = [
    '주가는 반드시 상승할 것이다', '확실히 오를 종목', '하락할 것이 분명하다', '목표주가 150,000원',
    '목표가는 200달러', '지금 매수하세요', '매수를 추천합니다', '100% 수익',
    '매수를 추천한다', '매도해야 한다', '반드시 오르는 종목',
  ];
  for (const text of assertive) {
    const { issues } = checkScenarios({ trendAnalysis: text });
    assert.equal(issues.length, 1, text);
    assert.equal(issues[0].path, 'trendAnalysis');
  }
});

test('가격이 아닌 목표·부정·과거 수익률은 걸리지 않는다', () => {
  const benign = [
    '성장 목표가 3가지다', '중기 목표가 2027년까지 달성된다', '주가가 반드시 상승하지는 않는다',
    '작년에 100% 상승했다', '1,100% 상승한 종목',
  ];
  for (const text of benign) {
    const { issues } = checkScenarios({ trendAnalysis: text });
    assert.deepEqual(issues, [], text);
  }
});

test('방향어 없는 "반드시"와 권유 부정은 걸리지 않는다', () => {
  const { issues } = checkScenarios({
    monitoringIndicators: ['반드시 확인해야 할 지표: 다음 분기 매출'],
    risks: ['이 보고서는 매수를 추천하지 않습니다.'],
    scenarios: [scenario()],
  });
  assert.deepEqual(issues, []);
});

test('면책 문구는 단정 표현 검사에서 제외한다', () => {
  const { issues } = checkScenarios({ disclaimer: '매수하세요' });
  assert.deepEqual(issues, []);
});
