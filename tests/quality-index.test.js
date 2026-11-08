import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessQuality, buildQualityContext, CHECK_ERROR_MESSAGE, LIMITED_MESSAGE,
} from '../lib/quality/index.js';
import { DISCLAIMER } from '../lib/prompt.js';

const SOURCES = [
  { sourceId: 'S1', title: '기사', source: '연합뉴스', publishedAt: '2026-08-30T09:00:00.000Z', type: 'news' },
  { sourceId: 'F1', title: 'NVIDIA SEC 제출 서류', source: 'SEC EDGAR', publishedAt: null, type: 'financial' },
];
const INSTRUMENTS = [{ symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', market: 'US', marketData: {} }];

test('buildQualityContext는 출처 Map과 자료 유무를 만든다', () => {
  const ctx = buildQualityContext({ sources: SOURCES, instruments: INSTRUMENTS, sector: undefined });
  assert.deepEqual([...ctx.sources.keys()], ['S1', 'F1']);
  assert.deepEqual(ctx.sources.get('S1'), { title: '기사', source: '연합뉴스', publishedAt: '2026-08-30T09:00:00.000Z' });
  assert.deepEqual(ctx.instruments, [{ symbol: 'NVDA', name: 'NVIDIA' }]);
  assert.deepEqual(ctx.has, { financial: true, research: false, experiments: false });
});

test('깨끗한 응답은 100점이고 이슈가 없다', () => {
  const ctx = buildQualityContext({ sources: SOURCES, instruments: INSTRUMENTS });
  const clean = {
    summary: '요약[S1]', newsBriefing: [], scenarios: [], instrumentComparison: [],
    financialSummary: { available: '자료 있음', periodBasis: '2분기', notes: '매출[F1]' },
    disclaimer: DISCLAIMER,
  };
  const { analysis, quality } = assessQuality(clean, ctx);
  assert.deepEqual(analysis, clean);
  assert.deepEqual(quality, { score: 100, fixed: 0, warnings: 0, issues: [], limited: false });
});

test('점수는 교정 10점, 경고 5점씩 깎고 0 아래로 내려가지 않는다', () => {
  const ctx = buildQualityContext({ sources: SOURCES, instruments: INSTRUMENTS });
  const { quality } = assessQuality({ summary: '[S9]', disclaimer: 'x', scenarios: [{ invalidationCondition: '' }] }, ctx);
  assert.equal(quality.fixed, 2);
  assert.equal(quality.warnings, 1);
  assert.equal(quality.score, 75);

  const many = { scenarios: Array.from({ length: 30 }, () => ({ invalidationCondition: '' })), disclaimer: DISCLAIMER };
  assert.equal(assessQuality(many, ctx).quality.score, 0);
});

test('검사 순서대로 이슈가 쌓인다', () => {
  const ctx = buildQualityContext({ sources: SOURCES, instruments: INSTRUMENTS });
  const { quality } = assessQuality({
    summary: '[S9]', disclaimer: 'x', scenarios: [{ invalidationCondition: '' }],
  }, ctx);
  assert.deepEqual(quality.issues.map((i) => i.check), ['citations', 'disclaimer', 'scenarios']);
});

test('검사기 예외는 그 검사만 건너뛰고 경고로 남긴다', () => {
  const ctx = buildQualityContext({ sources: SOURCES, instruments: INSTRUMENTS });
  const boom = () => { throw new Error('boom'); };
  const ok = (a) => ({ analysis: { ...a, touched: true }, issues: [] });
  const { analysis, quality } = assessQuality({ summary: 'x' }, ctx, { checks: [['broken', boom], ['ok', ok]] });
  assert.equal(analysis.touched, true);
  assert.deepEqual(quality.issues, [{ check: 'broken', severity: 'warning', message: CHECK_ERROR_MESSAGE, path: '' }]);
});

test('degraded 응답은 본문 인용만 고치고 limited로 표시한다', () => {
  const ctx = buildQualityContext({ sources: SOURCES, instruments: INSTRUMENTS });
  const { analysis, quality } = assessQuality({ report: '근거 [S1] [S9]' }, ctx, { degraded: true });
  assert.equal(analysis.report, '근거 [S1] [출처 미확인]');
  assert.equal(quality.limited, true);
  assert.deepEqual(quality.issues.map((i) => [i.check, i.severity]), [['citations', 'fixed'], ['structure', 'warning']]);
  assert.equal(quality.issues[1].message, LIMITED_MESSAGE);
});
