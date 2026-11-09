import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAvailability, NO_DATA_NOTE } from '../lib/quality/availability.js';

const NONE = { financial: false, research: false, experiments: false };
const summaries = (available) => ({
  financialSummary: { available, periodBasis: '2026년 2분기', notes: '매출 증가' },
  researchSummary: { available, maturity: '초기', notes: '논문' },
  experimentSummary: { available, evidenceLevel: '2상', notes: '임상' },
});

test('자료가 없는데 자료 있음이면 자료 부족으로 교정한다', () => {
  const input = summaries('자료 있음');
  const { analysis, issues } = checkAvailability(input, { has: NONE });
  assert.deepEqual(analysis.financialSummary, { available: '자료 부족', periodBasis: '자료 부족', notes: NO_DATA_NOTE });
  assert.deepEqual(analysis.researchSummary, { available: '자료 부족', maturity: '자료 부족', notes: NO_DATA_NOTE });
  assert.deepEqual(analysis.experimentSummary, { available: '자료 부족', evidenceLevel: '자료 부족', notes: NO_DATA_NOTE });
  assert.equal(issues.length, 3);
  assert.ok(issues.every((i) => i.check === 'availability' && i.severity === 'fixed'));
  assert.equal(input.financialSummary.available, '자료 있음', '입력이 바뀌었다');
});

test('자료가 있는데 자료 부족이면 경고만 남긴다', () => {
  const input = summaries('자료 부족');
  const { analysis, issues } = checkAvailability(input, { has: { financial: true, research: false, experiments: false } });
  assert.equal(analysis.financialSummary.available, '자료 부족');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'warning');
  assert.equal(issues[0].path, 'financialSummary.available');
});

test('자료와 표기가 맞으면 아무것도 남기지 않는다', () => {
  const { issues } = checkAvailability(summaries('자료 부족'), { has: NONE });
  assert.deepEqual(issues, []);
});

test('요약 필드가 없으면 건너뛴다', () => {
  const { analysis, issues } = checkAvailability({ summary: 'x' }, { has: NONE });
  assert.deepEqual(analysis, { summary: 'x' });
  assert.deepEqual(issues, []);
});
