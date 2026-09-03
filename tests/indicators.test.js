import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeIndicators, buildChartTrend } from '../server.js';

/** 100에서 1씩 오르는 종가 n개. 계산 검증이 쉽도록 값을 고정한다. */
const rising = (n) => Array.from({ length: n }, (_, i) => 100 + i);

test('기간 등락률을 계산한다', () => {
  const ind = computeIndicators([100, 110], [1, 1]);

  assert.equal(ind.first, 100);
  assert.equal(ind.last, 110);
  assert.equal(ind.changePct.toFixed(2), '10.00');
});

test('하락도 올바르게 계산한다', () => {
  const ind = computeIndicators([200, 150], [1, 1]);
  assert.equal(ind.changePct.toFixed(2), '-25.00');
});

test('최고·최저를 찾는다', () => {
  const ind = computeIndicators([100, 130, 90, 110], [1, 1, 1, 1]);
  assert.equal(ind.high, 130);
  assert.equal(ind.low, 90);
});

test('5일·20일 이동평균을 계산한다', () => {
  // 마지막 5개가 116..120이면 평균 118
  const ind = computeIndicators(rising(21), Array(21).fill(1));

  assert.equal(ind.ma5.toFixed(1), '118.0');
  // 마지막 20개가 101..120이면 평균 110.5
  assert.equal(ind.ma20.toFixed(1), '110.5');
});

test('데이터가 모자라면 해당 이동평균은 null이다', () => {
  const ind = computeIndicators(rising(10), Array(10).fill(1));

  assert.ok(ind.ma5 !== null, '10개면 ma5는 계산할 수 있다');
  assert.equal(ind.ma20, null, '10개로 20일 이동평균을 만들면 안 된다');
});

test('null 종가를 건너뛴다', () => {
  // Yahoo는 거래 없는 날에 null을 넣는다.
  const ind = computeIndicators([100, null, 110, null], [1, null, 1, null]);

  assert.equal(ind.points, 2);
  assert.equal(ind.first, 100);
  assert.equal(ind.last, 110);
});

test('유효 종가가 2개 미만이면 null을 반환한다', () => {
  assert.equal(computeIndicators([100], [1]), null);
  assert.equal(computeIndicators([], []), null);
  assert.equal(computeIndicators([null, null], [null, null]), null);
});

test('변동성은 일간 수익률의 표준편차다', () => {
  // 완전히 일정한 가격이면 변동성이 0에 가깝다.
  const flat = computeIndicators([100, 100, 100, 100], [1, 1, 1, 1]);
  assert.ok(flat.volatilityPct < 0.001);

  const jumpy = computeIndicators([100, 150, 80, 160], [1, 1, 1, 1]);
  assert.ok(jumpy.volatilityPct > flat.volatilityPct);
});

test('거래량 추세를 판정한다', () => {
  const up = computeIndicators(rising(20), Array.from({ length: 20 }, (_, i) => 100 + i * 50));
  assert.equal(up.volumeTrend, 'rising');

  const down = computeIndicators(rising(20), Array.from({ length: 20 }, (_, i) => 2000 - i * 50));
  assert.equal(down.volumeTrend, 'falling');

  const same = computeIndicators(rising(20), Array(20).fill(1000));
  assert.equal(same.volumeTrend, 'flat');
});

test('거래량이 없으면 volumeTrend가 null이다', () => {
  const ind = computeIndicators(rising(20), Array(20).fill(null));
  assert.equal(ind.volumeTrend, null);
});

// ─── 문장 생성 ───

test('추세 문장에 등락률과 이동평균 관계가 들어간다', () => {
  const ind = computeIndicators(rising(21), Array(21).fill(1000));
  const s = buildChartTrend(ind, { currency: 'USD' });

  assert.match(s, /20\.00%|상승/);
  assert.ok(s.includes('20일 이동평균'), '이동평균 언급이 없다');
  assert.ok(s.length > 20);
});

test('이동평균을 못 구하면 그 부분을 언급하지 않는다', () => {
  const ind = computeIndicators([100, 110, 120], [1, 1, 1]);
  const s = buildChartTrend(ind, { currency: 'USD' });

  assert.ok(!s.includes('20일 이동평균'), '없는 지표를 언급했다');
  assert.ok(s.length > 0);
});

test('지표가 null이면 자료 부족을 반환한다', () => {
  const s = buildChartTrend(null, { currency: 'USD' });
  assert.match(s, /자료 부족/);
});

test('추세 문장에 확정적 예측 표현을 넣지 않는다', () => {
  const ind = computeIndicators(rising(21), Array(21).fill(1000));
  const s = buildChartTrend(ind, { currency: 'USD' });

  for (const banned of ['예상', '전망', '목표주가', '매수', '매도', '것이다']) {
    assert.ok(!s.includes(banned), `확정적 표현이 들어갔다: ${banned}`);
  }
});

test('장중가가 마지막 종가와 다르면 그 사실을 밝힌다', () => {
  // 둘을 나란히 두면 모순처럼 보인다. 왜 다른지 설명해야 한다.
  const ind = computeIndicators([100, 110], [1, 1]);
  const s = buildChartTrend(ind, { currency: 'USD', livePrice: 115 });

  assert.ok(s.includes('115'), '장중가가 언급되지 않았다');
  assert.ok(s.includes('마감된 일봉'), '차이의 이유가 설명되지 않았다');
});

test('장중가가 마지막 종가와 같으면 중복 설명하지 않는다', () => {
  const ind = computeIndicators([100, 110], [1, 1]);
  const s = buildChartTrend(ind, { currency: 'USD', livePrice: 110 });

  assert.ok(!s.includes('마감된 일봉'), '같은 값인데 불필요한 설명이 붙었다');
});

test('장중가를 주지 않으면 해당 문장이 없다', () => {
  const ind = computeIndicators([100, 110], [1, 1]);
  const s = buildChartTrend(ind, { currency: 'USD' });

  assert.ok(!s.includes('현재 호가'));
});
