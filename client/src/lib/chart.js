/**
 * 가격 시계열을 SVG 좌표로 바꾼다.
 *
 * 컴포넌트에서 분리하는 이유는 좌표 계산이 순수 함수라 DOM 없이
 * 정확히 검증할 수 있기 때문이다.
 */
export function buildChartGeometry(points, { width, height, padding }) {
  if (!Array.isArray(points) || points.length < 2) return null;

  const values = points.map((p) => p.c);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  // 모든 값이 같으면 범위가 0이라 나눗셈이 NaN이 된다. 가운데 가로선으로 그린다.
  const toY = (c) => (span === 0
    ? padding + innerH / 2
    : padding + innerH - ((c - min) / span) * innerH);
  const toX = (i) => padding + (i / (points.length - 1)) * innerW;

  const xy = points.map((p, i) => ({ x: toX(i), y: toY(p.c), c: p.c, t: p.t }));

  return {
    xy,
    toX,
    toY,
    line: xy.map((p) => `${p.x},${p.y}`).join(' '),
    min,
    max,
    first: values[0],
    last: values[values.length - 1],
  };
}

/**
 * 이동평균 선. geometry의 toX·toY를 재사용하므로 원본 선과 축척이 같다.
 * 점이 창보다 적으면 계산하지 않는다 — 없는 지표를 그리면 안 된다.
 */
export function movingAverageLine(points, window, geometry) {
  if (!geometry || !Array.isArray(points) || points.length < window) return null;

  const out = [];
  for (let i = window - 1; i < points.length; i += 1) {
    let sum = 0;
    for (let k = i - window + 1; k <= i; k += 1) sum += points[k].c;
    out.push(`${geometry.toX(i)},${geometry.toY(sum / window)}`);
  }
  return out.join(' ');
}
