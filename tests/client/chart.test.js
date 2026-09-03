import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChartGeometry, movingAverageLine } from '../../client/src/lib/chart.js';

/** 100에서 10씩 오르는 점 n개. 좌표 검증이 쉽도록 값을 고정한다. */
const rising = (n) => Array.from({ length: n }, (_, i) => ({
  t: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
  c: 100 + i * 10,
  v: 1000,
}));

const BOX = { width: 600, height: 200, padding: 10 };

test('첫 점은 왼쪽 끝, 마지막 점은 오른쪽 끝에 놓인다', () => {
  const g = buildChartGeometry(rising(3), BOX);

  assert.equal(g.xy[0].x, 10);
  assert.equal(g.xy[2].x, 590);
});

test('최저값이 아래, 최고값이 위에 놓인다', () => {
  // SVG는 y가 아래로 증가하므로 최고값의 y가 더 작아야 한다.
  const g = buildChartGeometry(rising(3), BOX);

  assert.equal(g.xy[0].y, 190, '최저값이 바닥에 붙지 않았다');
  assert.equal(g.xy[2].y, 10, '최고값이 천장에 붙지 않았다');
});

test('중간값이 정확히 가운데 놓인다', () => {
  const g = buildChartGeometry(rising(3), BOX);
  assert.equal(g.xy[1].y, 100);
});

test('polyline 문자열을 만든다', () => {
  const g = buildChartGeometry(rising(3), BOX);
  assert.equal(g.line, '10,190 300,100 590,10');
});

test('min·max·first·last를 함께 준다', () => {
  const g = buildChartGeometry(rising(5), BOX);

  assert.equal(g.min, 100);
  assert.equal(g.max, 140);
  assert.equal(g.first, 100);
  assert.equal(g.last, 140);
});

test('모든 값이 같으면 0으로 나누지 않고 가운데 선을 그린다', () => {
  const flat = [{ t: 'a', c: 50 }, { t: 'b', c: 50 }, { t: 'c', c: 50 }];
  const g = buildChartGeometry(flat, BOX);

  assert.ok(Number.isFinite(g.xy[0].y), 'y가 NaN이다');
  assert.equal(g.xy[0].y, g.xy[2].y);
  assert.equal(g.xy[0].y, 100, '평평한 선은 세로 가운데에 놓여야 한다');
});

test('점이 2개 미만이면 null이다', () => {
  assert.equal(buildChartGeometry([{ t: 'a', c: 1 }], BOX), null);
  assert.equal(buildChartGeometry([], BOX), null);
  assert.equal(buildChartGeometry(null, BOX), null);
  assert.equal(buildChartGeometry(undefined, BOX), null);
});

test('원본 값을 좌표에 함께 남긴다', () => {
  // 툴팁에 실제 가격과 날짜를 보여줘야 한다.
  const g = buildChartGeometry(rising(3), BOX);

  assert.equal(g.xy[1].c, 110);
  assert.equal(g.xy[1].t, '2026-09-02T00:00:00.000Z');
});

// ─── 이동평균 ───

test('이동평균 선을 만든다', () => {
  const g = buildChartGeometry(rising(5), BOX);
  const line = movingAverageLine(rising(5), 3, g);

  // 점 5개에 창 3이면 3개 구간(인덱스 2,3,4)이 나온다.
  assert.equal(line.split(' ').length, 3);
});

test('점이 창보다 적으면 null이다', () => {
  const g = buildChartGeometry(rising(3), BOX);

  assert.equal(movingAverageLine(rising(3), 5, g), null);
  assert.equal(movingAverageLine(rising(3), 20, g), null);
});

test('이동평균은 원본 선과 같은 y 축척을 쓴다', () => {
  // 축척이 다르면 두 선이 어긋나 보인다.
  const pts = rising(5);
  const g = buildChartGeometry(pts, BOX);
  const line = movingAverageLine(pts, 5, g);

  // 5개 평균 = (100+110+120+130+140)/5 = 120, 범위 100~140의 정확히 가운데
  const [, y] = line.split(' ')[0].split(',').map(Number);
  assert.equal(y, 100);
});

test('geometry가 없으면 null이다', () => {
  assert.equal(movingAverageLine(rising(5), 3, null), null);
});
