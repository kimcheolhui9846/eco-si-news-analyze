import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkComparison } from '../lib/quality/comparison.js';

const FOUR = [
  { symbol: 'NVDA', name: 'NVIDIA' }, { symbol: 'TSM', name: 'TSMC' },
  { symbol: '005930.KS', name: '삼성전자' }, { symbol: '000660.KS', name: 'SK하이닉스' },
];
const entry = (symbol, name = symbol) => ({ symbol, name, positioning: '위치', keyDifference: '차이' });

test('입력에 없는 종목은 제거하고 빠진 종목은 경고한다', () => {
  const { analysis, issues } = checkComparison(
    { instrumentComparison: [entry('NVDA'), entry('TSM'), entry('005930.KS'), entry('AAPL')] }, { instruments: FOUR });
  assert.deepEqual(analysis.instrumentComparison.map((e) => e.symbol), ['NVDA', 'TSM', '005930.KS']);
  assert.ok(issues.some((i) => i.severity === 'fixed' && i.path === 'instrumentComparison[3]'));
  const warn = issues.find((i) => i.severity === 'warning');
  assert.ok(warn.message.includes('000660.KS'));
});

test('이름은 입력 종목 이름으로 조용히 맞춘다', () => {
  const { analysis, issues } = checkComparison(
    { instrumentComparison: FOUR.map((i) => entry(i.symbol, '엉뚱한 이름')) }, { instruments: FOUR });
  assert.deepEqual(analysis.instrumentComparison.map((e) => e.name), FOUR.map((i) => i.name));
  assert.deepEqual(issues, []);
});

test('소문자 종목 코드도 입력 종목으로 맞춰 유지한다', () => {
  const lower = [
    entry('nvda', 'x'), entry('tsm', 'x'), entry('005930.ks', 'x'), entry('000660.ks', 'x'),
  ];
  const { analysis, issues } = checkComparison({ instrumentComparison: lower }, { instruments: FOUR });
  assert.deepEqual(analysis.instrumentComparison.map((e) => e.symbol), FOUR.map((i) => i.symbol));
  assert.deepEqual(analysis.instrumentComparison.map((e) => e.name), FOUR.map((i) => i.name));
  assert.deepEqual(issues, []);
});

test('중복 종목은 첫 항목만 남긴다', () => {
  const list = [...FOUR.map((i) => entry(i.symbol)), entry('NVDA')];
  const { analysis, issues } = checkComparison({ instrumentComparison: list }, { instruments: FOUR });
  assert.equal(analysis.instrumentComparison.length, 4);
  assert.equal(issues.filter((i) => i.severity === 'fixed').length, 1);
});

test('종목이 하나 이하면 비교를 비운다', () => {
  const one = [FOUR[0]];
  const filled = checkComparison({ instrumentComparison: [entry('NVDA')] }, { instruments: one });
  assert.deepEqual(filled.analysis.instrumentComparison, []);
  assert.equal(filled.issues[0].severity, 'fixed');
  const empty = checkComparison({ instrumentComparison: [] }, { instruments: one });
  assert.deepEqual(empty.issues, []);
});

test('필드가 없으면 종목이 여럿일 때만 경고한다', () => {
  assert.equal(checkComparison({}, { instruments: FOUR }).issues[0].severity, 'warning');
  assert.deepEqual(checkComparison({}, { instruments: [FOUR[0]] }).issues, []);
});
