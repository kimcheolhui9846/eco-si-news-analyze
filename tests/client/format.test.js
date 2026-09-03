import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsd, formatDateTime, formatCount } from '../../client/src/lib/format.js';

test('비용은 소수점 아래를 살려 표기한다', () => {
  // 0.02로 반올림하면 0.004와 0.024가 같아 보여 예산 감각이 무너진다.
  assert.equal(formatUsd(0.023456), '$0.0235');
  assert.equal(formatUsd(0), '$0');
  assert.equal(formatUsd(5), '$5.0000');
});

test('비용이 숫자가 아니면 물음표를 준다', () => {
  assert.equal(formatUsd(null), '$?');
  assert.equal(formatUsd(undefined), '$?');
  assert.equal(formatUsd(NaN), '$?');
});

test('ISO 시각을 사람이 읽는 형태로 바꾼다', () => {
  const s = formatDateTime('2026-09-03T01:20:00.000Z');

  assert.match(s, /2026/);
  assert.match(s, /-09-|-9-/);
});

test('날짜가 이상하면 원본을 그대로 돌려준다', () => {
  assert.equal(formatDateTime('어제'), '어제');
  assert.equal(formatDateTime(''), '');
  assert.equal(formatDateTime(null), '');
});

test('개수에 단위를 붙인다', () => {
  assert.equal(formatCount(8, '건'), '8건');
  assert.equal(formatCount(0, '건'), '0건');
  assert.equal(formatCount(null, '건'), '-');
});
