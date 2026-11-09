import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessQuality } from '../lib/quality/index.js';
import {
  PAPER_CHECKS, buildPaperQualityContext, numberAppears, normalizeNumberText,
  checkSectionRefs, checkNumbers, checkPaperCoverage,
} from '../lib/quality/paper.js';

const SECTIONS = [
  { id: 'S0', anchor: 'abstract1', heading: 'Abstract', text: 'It reaches 85.3% recall@10.' },
  { id: 'S1', anchor: 'S1', heading: '1 Introduction', text: 'Dense retrievers are costly.' },
  { id: 'S2', anchor: 'S2', heading: '2 Method', text: 'A linear router with 1,024 hidden units.' },
  { id: 'S3', anchor: 'S3', heading: '3 Experiments', text: 'BM25\t71.2\nTinyMoE\t$85.3$\nImproves by 14.1 points with 3.2× less compute. Loss \u22120.5.' },
];
const ctx = (truncated = []) => buildPaperQualityContext({
  sources: SECTIONS.map((s) => ({ sourceId: s.id, title: s.heading, source: 'arXiv 2611.00001', type: 'section' })),
  sections: SECTIONS,
  truncated,
});
const CLEAN = {
  summary: 'TinyMoE는 희소 검색기다 [S0].',
  problem: { statement: '밀집 검색은 비싸다.', sourceIds: ['S1'] },
  method: { overview: '선형 라우터', keyIdeas: ['전문가 2개만 쓴다'], sourceIds: ['S2'] },
  experimentalSetup: { datasets: ['BEIR'], baselines: ['BM25'], metrics: ['Recall@10'], sourceIds: ['S3'] },
  keyResults: [{ claim: 'BM25보다 재현율이 높다', numbers: ['85.3', '71.2'], sourceIds: ['S3'] }],
  authorStatedLimitations: [],
  reviewerConcerns: [{ concern: '데이터셋이 하나뿐', why: '일반화 근거 부족', severity: '중요', sourceIds: ['S3'] }],
  reproducibility: { code: '언급 없음', data: '공개', note: 'BEIR는 공개 데이터셋', sourceIds: ['S3'] },
  openQuestions: ['다른 도메인에서도 유지되는가?'],
};
const run = (analysis, truncated) => assessQuality(analysis, ctx(truncated), { checks: PAPER_CHECKS });

test('깨끗한 보고서는 100점이다', () => {
  const { quality, analysis } = run(CLEAN);
  assert.deepEqual(quality.issues, []);
  assert.equal(quality.score, 100);
  assert.deepEqual(analysis, CLEAN);
});

test('수치 일치: 표기 차이를 맞추고 숫자 경계를 지킨다', () => {
  const text = normalizeNumberText(SECTIONS[3].text + ' ' + SECTIONS[2].text);
  for (const v of ['85.3', '85.3%', '71.2', '14.1', '3.2×', '3.2x', '1,024', '1024', '-0.5', '\u22120.5', '$85.3$', '14.1 points']) {
    assert.ok(numberAppears(v, text), v);
  }
  for (const v of ['5.3', '85', '85.31', '71', '0.85', '', '99.9', '1,02']) {
    assert.ok(!numberAppears(v, text), v);
  }
});

test('인용 장 본문에 없는 수치는 지우고, 모두 없으면 항목을 제거한다', () => {
  const analysis = {
    ...CLEAN,
    keyResults: [
      { claim: '일부 위조', numbers: ['85.3', '92.7'], sourceIds: ['S3'] },
      { claim: '모두 위조', numbers: ['99.1'], sourceIds: ['S3'] },
      { claim: '다른 장 수치', numbers: ['1,024'], sourceIds: ['S3'] },
      { claim: '정성 결과', numbers: [], sourceIds: ['S3'] },
    ],
  };
  const { analysis: out, issues } = checkNumbers(analysis, ctx());
  assert.deepEqual(out.keyResults.map((r) => [r.claim, r.numbers]), [['일부 위조', ['85.3']], ['정성 결과', []]]);
  assert.deepEqual(issues.map((i) => [i.check, i.severity, i.path]), [
    ['numbers', 'fixed', 'keyResults[0].numbers'],
    ['numbers', 'fixed', 'keyResults[1]'],
    ['numbers', 'fixed', 'keyResults[2]'],
  ]);
  // 메시지에는 모델이 쓴 값이 들어가지 않는다.
  assert.ok(issues.every((i) => !i.message.includes('92.7') && !i.message.includes('99.1')));
});

test('모르는 장 ID: 객체 섹션은 빼고 경고, 목록 항목은 근거가 비면 제거', () => {
  const analysis = {
    ...CLEAN,
    problem: { statement: 'x', sourceIds: ['S9'] },
    method: { ...CLEAN.method, sourceIds: ['S2', 'S7', 'S2'] },
    authorStatedLimitations: [{ point: '근거 없음', sourceIds: ['S8'] }, { point: '근거 있음', sourceIds: ['S1', 'S8'] }],
  };
  const { analysis: out, issues } = checkSectionRefs(analysis, ctx());
  assert.deepEqual(out.problem.sourceIds, []);
  assert.deepEqual(out.method.sourceIds, ['S2']);
  assert.deepEqual(out.authorStatedLimitations, [{ point: '근거 있음', sourceIds: ['S1'] }]);
  assert.deepEqual(issues.map((i) => [i.severity, i.path]), [
    ['fixed', 'problem.sourceIds'],
    ['warning', 'problem'],
    ['fixed', 'method.sourceIds'],
    ['fixed', 'authorStatedLimitations[0]'],
    ['fixed', 'authorStatedLimitations[1].sourceIds'],
  ]);
});

test('본문 속 [S9] 인용은 "출처 미확인"으로 바뀐다', () => {
  const { analysis, quality } = run({ ...CLEAN, summary: '요약 [S9]' });
  assert.equal(analysis.summary, '요약 [출처 미확인]');
  assert.ok(quality.issues.some((i) => i.check === 'citations' && i.severity === 'fixed'));
});

test('잘린 장이 있으면 경고하고, 그 장 ID 인용은 모르는 ID로 지운다', () => {
  // 잘려서 빠진 S4는 출처 목록에 없다.
  const analysis = { ...CLEAN, reviewerConcerns: [{ concern: 'c', why: 'w', severity: '경미', sourceIds: ['S4'] }] };
  const { analysis: out, quality } = run(analysis, [{ id: 'S4', heading: '4 Ablation', partial: false }]);
  assert.deepEqual(out.reviewerConcerns, []);
  const coverage = quality.issues.filter((i) => i.check === 'coverage');
  assert.deepEqual(coverage.map((i) => i.severity), ['warning', 'warning']);
  assert.ok(coverage[0].message.includes('1개 장'));
});

test('실험 장이 있는데 keyResults가 비면 경고, reviewerConcerns가 비어도 경고', () => {
  const { issues } = checkPaperCoverage({ ...CLEAN, keyResults: [], reviewerConcerns: [] }, ctx());
  assert.deepEqual(issues.map((i) => i.path), ['keyResults', 'reviewerConcerns']);
});

test('실험·결과 장이 없으면 빈 keyResults를 경고하지 않는다', () => {
  const sections = SECTIONS.slice(0, 3);
  const c = buildPaperQualityContext({
    sources: sections.map((s) => ({ sourceId: s.id, title: s.heading, source: 'a', type: 'section' })), sections, truncated: [],
  });
  assert.deepEqual(checkPaperCoverage({ ...CLEAN, keyResults: [] }, c).issues, []);
});

test('투자 표현은 경고한다', () => {
  const { quality } = run({ ...CLEAN, summary: '이 논문으로 매수 기회 [S0]' });
  assert.ok(quality.issues.some((i) => i.check === 'investmentLanguage'));
});
