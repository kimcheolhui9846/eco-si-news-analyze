import 'global-jsdom/register';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup } from '@testing-library/react';

import FinancialMetrics from '../../client/src/components/FinancialMetrics.jsx';
import ResearchList from '../../client/src/components/ResearchList.jsx';
import ExperimentStatus from '../../client/src/components/ExperimentStatus.jsx';
import { emptySectionMessage } from '../../client/src/lib/dataSection.js';

afterEach(cleanup);

const FINANCIAL = {
  symbol: 'NVDA', cik: '0001045810', entityName: 'NVIDIA CORP',
  filingUrl: 'https://www.sec.gov/Archives/edgar/data/1045810/x/y-index.htm',
  metrics: [{
    concept: 'Revenues', label: '매출', value: 96221000000, unit: 'USD',
    periodStart: '2026-04-27', periodEnd: '2026-07-26',
    fiscalYear: 2027, fiscalPeriod: 'Q2', form: '10-Q', filed: '2026-08-26',
  }],
  derived: [{ label: '부채비율', value: 41.2, unit: '%', basis: '2026-07-26 기준', formula: '부채 / 자산' }],
  degraded: [],
};

const PAPER = {
  title: '배터리 재활용 공정', abstract: '초록입니다.', authors: ['홍길동'], authorCount: 1,
  venue: 'Nature Energy', doi: '10.1/abc', url: 'https://doi.org/10.1/abc',
  publishedAt: '2026-01-01T00:00:00.000Z', datePrecision: 'year',
  peerReviewed: 'peer-reviewed', sourceName: 'Europe PMC', language: 'en',
};

const TRIAL = {
  nctId: 'NCT00644098', title: '섬유 혼합물 연구', organization: 'Canadian Center',
  url: 'https://clinicaltrials.gov/study/NCT00644098',
  phase: 'PHASE2', status: 'COMPLETED', enrollmentCount: 138, enrollmentType: 'ACTUAL',
  conditions: ['Overweight'], startDate: '2008-09', hasResults: false,
};

const COLLECTED = {
  included: ['news', 'market', 'financial', 'research', 'experiments'],
  degraded: [],
  languageRoute: null,
};

// ─── 재무 ───

test('각 값에 기준 기간과 제출 서류를 함께 보여준다', () => {
  render(<FinancialMetrics financial={FINANCIAL} collected={COLLECTED} />);
  assert.ok(screen.getByText(/FY2027 Q2/));
  assert.ok(screen.getByText(/10-Q/));
});

test('계산값을 계산값으로 표시한다', () => {
  render(<FinancialMetrics financial={FINANCIAL} collected={COLLECTED} />);
  // 정규식으로 찾으면 <th>와 그 안의 <span>이 함께 걸려 실패한다. 정확히 일치시킨다.
  assert.ok(screen.getByText('계산값'));
  assert.ok(screen.getByText(/부채 \/ 자산/));
});

test('재무가 없으면 감추지 않고 사유를 적는다', () => {
  const collected = {
    included: ['news', 'financial'],
    degraded: [{ provider: 'financial', reason: '미국 상장사가 아니거나 사전에 없는 종목입니다.' }],
    languageRoute: null,
  };
  render(<FinancialMetrics financial={null} collected={collected} />);
  assert.ok(screen.getByText(/미국 상장사가 아니거나/));
});

// ─── 논문 ───

test('동료 심사 배지를 보여준다', () => {
  render(<ResearchList items={[PAPER]} collected={COLLECTED} />);
  assert.ok(screen.getByText('동료 심사'));
});

test('프리프린트 배지를 보여준다', () => {
  // 심사를 거치지 않았다는 사실이 학술지 논문과 섞이면 안 된다.
  render(<ResearchList items={[{ ...PAPER, peerReviewed: 'preprint', sourceName: 'arXiv' }]} collected={COLLECTED} />);
  assert.ok(screen.getByText('프리프린트'));
});

test('연도만 아는 발표일을 연도로만 표시한다', () => {
  render(<ResearchList items={[PAPER]} collected={COLLECTED} />);
  assert.ok(screen.getByText(/2026년/));
  assert.equal(screen.queryByText(/2026-01-01/), null);
});

test('한국어 질의로 영어 소스가 생략되면 그 이유를 적는다', () => {
  const collected = {
    included: ['news', 'research'],
    degraded: [{ provider: 'research', source: 'KCI', reason: '국내 논문 검색에는 KCI API 키가 필요합니다.' }],
    languageRoute: {
      route: 'ko',
      reason: '한국어 질의입니다. 해외 논문 DB는 영문 질의에서만 동작합니다.',
    },
  };
  render(<ResearchList items={[]} collected={collected} />);
  assert.ok(screen.getByText(/KCI API 키/));
  assert.ok(screen.getByText(/해외 논문 DB/));
});

// ─── 실험 ───

test('단계·상태·표본 수를 보여준다', () => {
  render(<ExperimentStatus items={[TRIAL]} collected={COLLECTED} />);
  assert.ok(screen.getByText('PHASE2'));
  assert.ok(screen.getByText(/138명/));
});

test('목표치 표본 수를 목표로 표시한다', () => {
  // 목표를 실제 등록 수처럼 보이게 하면 연구 규모를 오해한다.
  render(<ExperimentStatus items={[{ ...TRIAL, enrollmentCount: 300, enrollmentType: 'ESTIMATED' }]} collected={COLLECTED} />);
  assert.ok(screen.getByText(/300명/));
  assert.ok(screen.getByText(/목표/));
});

// ─── 빈 섹션 문구 ───

test('선택하지 않았으면 그렇게 적는다', () => {
  const message = emptySectionMessage('research', { included: ['news'], degraded: [], languageRoute: null });
  assert.match(message, /선택하지 않/);
});

test('사유가 있으면 서버가 준 문구를 그대로 쓴다', () => {
  const message = emptySectionMessage('experiments', {
    included: ['news', 'experiments'],
    degraded: [{ provider: 'experiments', reason: '임상시험 자료는 영문 질의에서만 제공됩니다.' }],
    languageRoute: null,
  });
  assert.match(message, /영문 질의에서만 제공됩니다/);
});

test('검색은 됐으나 0건이면 그렇게 적는다', () => {
  const message = emptySectionMessage('research', {
    included: ['news', 'research'], degraded: [], languageRoute: null,
  });
  assert.match(message, /검색 결과가 없습니다/);
});
