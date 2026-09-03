/**
 * OHLC에서 차트 지표를 결정적으로 계산한다.
 *
 * LLM에게 차트 해석을 맡기지 않는 이유는 없는 추세를 지어내기 때문이다.
 * 숫자는 코드가 만들고 모델은 그 숫자를 설명만 한다.
 */
export function computeIndicators(closes, volumes = []) {
  // Yahoo는 거래 없는 날에 null을 넣는다.
  const valid = [];
  const validVolumes = [];

  for (let i = 0; i < closes.length; i += 1) {
    const c = closes[i];
    if (typeof c === 'number' && Number.isFinite(c)) {
      valid.push(c);
      const v = volumes[i];
      if (typeof v === 'number' && Number.isFinite(v)) validVolumes.push(v);
    }
  }

  if (valid.length < 2) return null;

  const first = valid[0];
  const last = valid[valid.length - 1];

  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const movingAverage = (n) => (valid.length >= n ? mean(valid.slice(-n)) : null);

  // 일간 수익률의 표준편차. 절대 가격이 아니라 변동 폭을 본다.
  const returns = [];
  for (let i = 1; i < valid.length; i += 1) {
    if (valid[i - 1] !== 0) returns.push((valid[i] - valid[i - 1]) / valid[i - 1]);
  }
  const returnMean = returns.length ? mean(returns) : 0;
  const variance = returns.length ? mean(returns.map((r) => (r - returnMean) ** 2)) : 0;

  // 거래량 추세는 전반부 평균과 후반부 평균을 비교한다.
  let volumeTrend = null;
  if (validVolumes.length >= 4) {
    const half = Math.floor(validVolumes.length / 2);
    const early = mean(validVolumes.slice(0, half));
    const late = mean(validVolumes.slice(half));
    const delta = early === 0 ? 0 : (late - early) / early;
    volumeTrend = delta > 0.15 ? 'rising' : delta < -0.15 ? 'falling' : 'flat';
  }

  return {
    first,
    last,
    changePct: ((last - first) / first) * 100,
    high: Math.max(...valid),
    low: Math.min(...valid),
    ma5: movingAverage(5),
    ma20: movingAverage(20),
    volatilityPct: Math.sqrt(variance) * 100,
    volumeTrend,
    points: valid.length,
  };
}

const VOLUME_LABEL = { rising: '증가', falling: '감소', flat: '보합' };

/**
 * 지표를 사람이 읽는 한 문단으로 만든다.
 *
 * 사실만 서술한다. 예측·전망·매매 권유 표현을 쓰지 않는다 —
 * 시스템 프롬프트가 금지하는 것을 입력 데이터가 먼저 어기면 안 된다.
 */
export function buildChartTrend(indicators, { currency, livePrice } = {}) {
  if (!indicators) return '자료 부족 — 추세를 계산할 만큼의 가격 데이터가 없습니다.';

  const { last, changePct, high, low, ma5, ma20, volatilityPct, volumeTrend, points } = indicators;
  const unit = currency ? ` ${currency}` : '';
  const direction = changePct >= 0 ? '상승' : '하락';

  const parts = [
    `해당 기간(${points}개 거래일) 종가는 ${changePct.toFixed(2)}% ${direction}했습니다.`,
    `기간 중 최고 ${high.toLocaleString()}${unit}, 최저 ${low.toLocaleString()}${unit}이며 마지막 종가는 ${last.toLocaleString()}${unit}입니다.`,
  ];

  // 계산되지 않은 지표는 언급하지 않는다. 없는 것을 있는 것처럼 말하지 않는다.
  if (ma5 !== null) {
    parts.push(`현재가는 5일 이동평균(${ma5.toFixed(2)})을 ${last >= ma5 ? '상회' : '하회'}합니다.`);
  }
  if (ma20 !== null) {
    parts.push(`20일 이동평균(${ma20.toFixed(2)}) 대비로는 ${last >= ma20 ? '상회' : '하회'}합니다.`);
  }

  // 장중가와 마지막 일봉 종가는 다를 수 있다. 둘을 나란히 두면 모순처럼 보이므로
  // 왜 다른지 명시한다.
  if (typeof livePrice === 'number' && Number.isFinite(livePrice) && livePrice !== last) {
    parts.push(`현재 호가는 ${livePrice.toLocaleString()}${unit}로, 위 종가는 마지막으로 마감된 일봉 기준입니다.`);
  }

  parts.push(`일간 수익률 표준편차는 ${volatilityPct.toFixed(2)}%입니다.`);

  if (volumeTrend) {
    parts.push(`거래량은 기간 전반부 대비 후반부에 ${VOLUME_LABEL[volumeTrend]} 추세입니다.`);
  }

  return parts.join(' ');
}
