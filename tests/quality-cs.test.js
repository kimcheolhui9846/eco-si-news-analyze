import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSourceRefs, checkEvidence, checkCoverage, checkInvestmentLanguage,
  CS_CHECKS, buildCsQualityContext,
} from '../lib/quality/cs.js';
import { replaceUnknownIds, checkCitations } from '../lib/quality/citations.js';
import { assessQuality } from '../lib/quality/index.js';
import {
  CS_JSON_SCHEMA, CS_MOCK_REPORT, EVIDENCE_LEVELS, COVERAGE_LEVELS,
} from '../lib/modes/cs-schema.js';

const ctx = (ids = ['P1', 'P2', 'H1', 'S1', 'B1', 'G1'], total = ids.length) => ({
  sources: new Map(ids.map((id) => [id, { title: id, source: 'x', publishedAt: '', type: 'x' }])),
  total,
});
const dev = (over = {}) => ({
  title: 't', whatIsNew: 'n', whyItMatters: 'w', evidenceLevel: '프리프린트', sourceIds: ['P1'], ...over,
});
const brief = (issues) => issues.map((i) => [i.check, i.severity, i.path]);

test('citations는 새 접두사 H·B·G도 출처 ID로 본다', () => {
  assert.deepEqual(replaceUnknownIds('[H9] [B1] [G2]', new Set(['B1']), 'PHSBG'), {
    text: '[출처 미확인] [B1] [출처 미확인]', changed: true,
  });
});

test('sourceRefs: 없는 ID는 빼고 중복은 조용히 합친다', () => {
  const { analysis, issues } = checkSourceRefs({ keyDevelopments: [dev({ sourceIds: ['P1', 'P9', 'P1'] })] }, ctx());
  assert.deepEqual(analysis.keyDevelopments[0].sourceIds, ['P1']);
  assert.deepEqual(brief(issues), [['sourceRefs', 'fixed', 'keyDevelopments[0].sourceIds']]);
});

test('sourceRefs: 중복만 있으면 이슈 없이 합친다', () => {
  const { analysis, issues } = checkSourceRefs({ keyDevelopments: [dev({ sourceIds: ['P1', 'P1'] })] }, ctx());
  assert.deepEqual(analysis.keyDevelopments[0].sourceIds, ['P1']);
  assert.deepEqual(issues, []);
});

test('sourceRefs: 근거가 모두 사라진 동향은 교정과 경고', () => {
  const { analysis, issues } = checkSourceRefs({ keyDevelopments: [dev({ sourceIds: ['X1'] })] }, ctx());
  assert.deepEqual(analysis.keyDevelopments[0].sourceIds, []);
  assert.deepEqual(brief(issues), [
    ['sourceRefs', 'fixed', 'keyDevelopments[0].sourceIds'],
    ['sourceRefs', 'warning', 'keyDevelopments[0]'],
  ]);
});

test('sourceRefs: 처음부터 근거가 없는 동향은 경고만', () => {
  const { issues } = checkSourceRefs({ keyDevelopments: [dev({ sourceIds: [] })] }, ctx());
  assert.deepEqual(brief(issues), [['sourceRefs', 'warning', 'keyDevelopments[0]']]);
});

test('sourceRefs: 하이라이트·신호는 없는 ID면 항목째 제거', () => {
  const { analysis, issues } = checkSourceRefs({
    paperHighlights: [
      { sourceId: 'P1', contribution: 'c', method: 'm', limitations: 'l' },
      { sourceId: 'P7', contribution: 'c', method: 'm', limitations: 'l' },
    ],
    openSourceSignals: [{ sourceId: 'G5', signal: 's' }],
  }, ctx());
  assert.deepEqual(analysis.paperHighlights.map((p) => p.sourceId), ['P1']);
  assert.deepEqual(analysis.openSourceSignals, []);
  assert.deepEqual(brief(issues), [
    ['sourceRefs', 'fixed', 'paperHighlights[1].sourceId'],
    ['sourceRefs', 'fixed', 'openSourceSignals[0].sourceId'],
  ]);
});

test('sourceRefs: 모델이 쓴 원문을 메시지에 넣지 않는다', () => {
  const { issues } = checkSourceRefs({ paperHighlights: [{ sourceId: '<script>' }] }, ctx());
  assert.ok(issues[0].message.includes('형식 오류'));
  assert.equal(issues[0].message.includes('<script>'), false);
});

test('evidence: 근거가 P뿐인 동료 심사 논문은 프리프린트로 교정', () => {
  const { analysis, issues } = checkEvidence({
    keyDevelopments: [dev({ evidenceLevel: '동료 심사 논문', sourceIds: ['P1', 'P2'] })],
  });
  assert.equal(analysis.keyDevelopments[0].evidenceLevel, '프리프린트');
  assert.deepEqual(brief(issues), [['evidence', 'fixed', 'keyDevelopments[0].evidenceLevel']]);
});

test('evidence: P와 다른 근거가 섞이면 그대로 둔다', () => {
  const { issues } = checkEvidence({
    keyDevelopments: [dev({ evidenceLevel: '동료 심사 논문', sourceIds: ['P1', 'S1'] })],
  });
  assert.deepEqual(issues, []);
});

test('evidence: 코드 공개인데 근거에 G가 없으면 경고', () => {
  const { analysis, issues } = checkEvidence({
    keyDevelopments: [dev({ evidenceLevel: '코드 공개', sourceIds: ['H1'] }), dev({ evidenceLevel: '코드 공개', sourceIds: ['G1'] })],
  });
  assert.equal(analysis.keyDevelopments[0].evidenceLevel, '코드 공개');
  assert.deepEqual(brief(issues), [['evidence', 'warning', 'keyDevelopments[0].evidenceLevel']]);
});

test('coverage: 5건 미만인데 충분이면 부족으로 교정', () => {
  const report = { sourceCoverage: { level: '충분', note: 'n' } };
  const low = checkCoverage(report, ctx(['P1', 'H1', 'S1', 'B1'], 4));
  assert.equal(low.analysis.sourceCoverage.level, '부족');
  assert.equal(low.analysis.sourceCoverage.note, 'n');
  assert.deepEqual(brief(low.issues), [['coverage', 'fixed', 'sourceCoverage.level']]);

  assert.deepEqual(checkCoverage(report, ctx(['P1', 'H1', 'S1', 'B1', 'G1'], 5)).issues, []);
  assert.deepEqual(checkCoverage({ sourceCoverage: { level: '부분적', note: '' } }, ctx(['P1'], 1)).issues, []);
});

test('investmentLanguage: 투자 표현을 경로당 한 번 경고', () => {
  const { analysis, issues } = checkInvestmentLanguage({
    summary: '매수 추천. 목표주가 10만원',
    whatToWatch: ['엔비디아 주가 흐름', '벤치마크 공개'],
  });
  assert.equal(analysis.summary, '매수 추천. 목표주가 10만원');
  assert.deepEqual(brief(issues), [
    ['investmentLanguage', 'warning', 'summary'],
    ['investmentLanguage', 'warning', 'whatToWatch[0]'],
  ]);
});

test('investmentLanguage: 외주가·추가 같은 낱말은 걸리지 않는다', () => {
  const { issues } = checkInvestmentLanguage({ summary: '외주가 늘고 기능 추가가 이어졌다. 투자 유치 소식도 있다.' });
  assert.deepEqual(issues, []);
});

test('CS 검사 순서', () => {
  assert.deepEqual(CS_CHECKS.map(([name]) => name), ['citations', 'sourceRefs', 'evidence', 'coverage', 'investmentLanguage']);
});

test('buildCsQualityContext는 서버 출처로 맥락을 만든다', () => {
  const c = buildCsQualityContext([
    { sourceId: 'P1', title: 't', source: 'arXiv (cs.CL)', publishedAt: 'd', url: 'https://a', type: 'paper' },
  ]);
  assert.deepEqual([...c.sources.entries()], [['P1', { title: 't', source: 'arXiv (cs.CL)', publishedAt: 'd', type: 'paper' }]]);
  assert.equal(c.total, 1);
});

test('CS mock 보고서는 CS 검사를 감점 없이 통과한다', () => {
  const { quality } = assessQuality(CS_MOCK_REPORT, ctx(['P1', 'H1', 'S1']), { checks: CS_CHECKS });
  assert.equal(quality.score, 100);
});

test('CS JSON 스키마는 strict이고 모든 객체가 전 속성 required다', () => {
  assert.equal(CS_JSON_SCHEMA.name, 'cs_trend_briefing');
  assert.equal(CS_JSON_SCHEMA.strict, true);
  assert.deepEqual(EVIDENCE_LEVELS, ['동료 심사 논문', '프리프린트', '공식 발표·블로그', '코드 공개', '커뮤니티 화제', '언론 보도']);
  assert.deepEqual(COVERAGE_LEVELS, ['충분', '부분적', '부족']);

  const walk = (node) => {
    if (node?.type === 'object') {
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      assert.equal(node.additionalProperties, false);
      Object.values(node.properties).forEach(walk);
    }
    if (node?.type === 'array') walk(node.items);
  };
  walk(CS_JSON_SCHEMA.schema);
  assert.deepEqual(Object.keys(CS_JSON_SCHEMA.schema.properties), [
    'summary', 'keyDevelopments', 'paperHighlights', 'communityPulse',
    'openSourceSignals', 'openQuestions', 'whatToWatch', 'sourceCoverage',
  ]);
});

test('CS 컨텍스트는 PHSBG 접두사를 쓰고 T는 건드리지 않는다', () => {
  assert.equal(buildCsQualityContext([]).idPrefixes, 'PHSBG');
  const { analysis, issues } = checkCitations(
    { summary: '근거 [H9] [T1]' }, { ...ctx(['P1']), idPrefixes: 'PHSBG' },
  );
  assert.equal(analysis.summary, '근거 [출처 미확인] [T1]');
  assert.equal(issues.length, 1);
});

test('sourceRefs: 논문 하이라이트는 P, 오픈소스 신호는 G 출처만 허용한다', () => {
  const { analysis, issues } = checkSourceRefs({
    paperHighlights: [{ sourceId: 'P1' }, { sourceId: 'G1' }, { sourceId: 'zzz' }],
    openSourceSignals: [{ sourceId: 'G1' }, { sourceId: 'P1' }],
  }, ctx());
  assert.deepEqual(analysis.paperHighlights, [{ sourceId: 'P1' }, ]);
  assert.deepEqual(analysis.openSourceSignals, [{ sourceId: 'G1' }]);
  assert.deepEqual(brief(issues), [
    ['sourceRefs', 'fixed', 'paperHighlights[1].sourceId'],
    ['sourceRefs', 'fixed', 'paperHighlights[2].sourceId'],
    ['sourceRefs', 'fixed', 'openSourceSignals[1].sourceId'],
  ]);
  assert.match(issues[0].message, /종류가 맞지 않아/);
  assert.match(issues[0].message, /G1/);
});
