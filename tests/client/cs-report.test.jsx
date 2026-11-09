import 'global-jsdom/register';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../../client/src/App.jsx';
import CsReportPage from '../../client/src/pages/CsReportPage.jsx';
import { CS_COLLECT } from './cs-fixtures.js';

afterEach(cleanup);

const SOURCES = [
  { sourceId: 'P1', title: 'Sparse MoE for retrieval', source: 'arXiv (cs.CL)', url: 'https://arxiv.org/abs/2611.00001', publishedAt: '2026-11-02T00:00:00.000Z', collectedAt: '2026-11-09T00:00:00.000Z', type: 'paper' },
  { sourceId: 'G1', title: 'example/tiny-rag', source: 'GitHub', url: 'https://github.com/example/tiny-rag', publishedAt: '2026-11-06T00:00:00.000Z', collectedAt: '2026-11-09T00:00:00.000Z', type: 'repo' },
];

const FULL = {
  analysis: {
    summary: 'RAG 검색 품질 개선이 화제다 [P1].',
    keyDevelopments: [{
      title: '희소 MoE 검색', whatIsNew: '긴 문맥 검색에 적용 [P1].', whyItMatters: '비용 절감 가능성.',
      evidenceLevel: '프리프린트', sourceIds: ['P1'],
    }],
    paperHighlights: [{ sourceId: 'P1', contribution: '희소 MoE 적용', method: '전문가 라우팅', limitations: '초록에 한계가 명시되지 않음' }],
    communityPulse: '구현이 단순하다는 반응 [H1].',
    openSourceSignals: [{ sourceId: 'G1', signal: '최근 갱신' }],
    openQuestions: ['분포 이동에도 유지되는가?'],
    whatToWatch: ['하이브리드 검색 도입'],
    sourceCoverage: { level: '부분적', note: '저장소가 하나뿐이다.' },
  },
  sources: SOURCES,
  meta: { quality: { score: 100, fixed: 0, warnings: 0, issues: [], limited: false }, degraded: false, collectedAt: '2026-11-09T00:00:00.000Z' },
};

test('CS 보고서: 요약·동향·논문 하이라이트·신호·질문·출처를 순서대로 그린다', () => {
  render(<CsReportPage report={FULL} onNewSearch={() => {}} />);

  assert.ok(screen.getByText('자동 검증 통과'));
  assert.ok(screen.getByText('RAG 검색 품질 개선이 화제다 [P1].'));
  assert.ok(screen.getByText(/자료 충분도: 부분적/));
  assert.ok(screen.getByText('희소 MoE 검색'));
  assert.ok(screen.getByText('프리프린트'));
  assert.ok(screen.getByText('희소 MoE 적용', { exact: false }));
  assert.ok(screen.getByText('최근 갱신', { exact: false }));
  assert.ok(screen.getByText('분포 이동에도 유지되는가?'));
  assert.ok(screen.getByText('하이브리드 검색 도입'));
  assert.ok(screen.getByRole('heading', { name: /출처/ }));

  const deep = screen.getAllByRole('button', { name: '전문 분석 (준비 중)' });
  assert.equal(deep.length, 1);
  assert.equal(deep[0].disabled, true);

  const headings = screen.getAllByRole('heading').map((h) => h.textContent);
  const order = ['핵심 요약', '주요 동향', '논문 하이라이트', '커뮤니티 반응', '오픈소스 신호', '미해결 질문', '지켜볼 것'];
  const positions = order.map((t) => headings.findIndex((h) => h.startsWith(t)));
  assert.ok(positions.every((p) => p >= 0), JSON.stringify(headings));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('CS 보고서: 빈 자료는 자료 없음으로 표시한다', () => {
  render(<CsReportPage report={{
    analysis: {
      summary: '', keyDevelopments: [], paperHighlights: [], communityPulse: '',
      openSourceSignals: [], openQuestions: [], whatToWatch: [],
      sourceCoverage: { level: '부족', note: '자료가 적다.' },
    },
    sources: [], meta: {},
  }} onNewSearch={() => {}} />);

  assert.ok(screen.getAllByText('자료 없음').length >= 6);
  assert.equal(screen.queryByRole('button', { name: '전문 분석 (준비 중)' }), null);
});

test('CS 보고서: 모델 문자열을 HTML로 해석하지 않는다', () => {
  const { container } = render(<CsReportPage report={{
    ...FULL, analysis: { ...FULL.analysis, summary: '<img src=x onerror=alert(1)>' },
  }} onNewSearch={() => {}} />);
  assert.ok(screen.getByText('<img src=x onerror=alert(1)>'));
  assert.equal(container.querySelector('img'), null);
});

test('CS 보고서: 구조화에 실패한 응답은 본문 텍스트로 보인다', () => {
  render(<CsReportPage report={{
    analysis: { report: '# 브리핑\n\n본문입니다' }, sources: [],
    meta: { degraded: true, quality: { score: 95, fixed: 0, warnings: 1, limited: true, issues: [{ check: 'structure', severity: 'warning', message: '구조화 응답이 아니어서 검증이 제한되었습니다.', path: '' }] } },
  }} onNewSearch={() => {}} />);
  assert.ok(screen.getByText(/본문입니다/));
  assert.ok(screen.getByText('(검증 제한)'));
});

test('App: CS 분석이 끝나면 CS 보고서 화면을 보인다', async () => {
  const api = {
    login: async () => ({ token: 't', expiresAt: 'x' }),
    budget: async () => CS_COLLECT.estimate.budget,
    collect: async () => CS_COLLECT,
    analyze: async () => FULL,
    logout: async () => {},
  };
  render(<App api={api} />);
  fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: /로그인/ }));
  await waitFor(() => assert.ok(screen.getByRole('tab', { name: 'CS 동향' })));
  fireEvent.click(screen.getByRole('tab', { name: 'CS 동향' }));
  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: 'rag' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));
  await waitFor(() => assert.ok(screen.getByRole('button', { name: /분석 시작/ })));
  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));

  await waitFor(() => assert.ok(screen.getByText('희소 MoE 검색')));
  // 새 검색으로 돌아가도 CS 탭이 유지된다.
  fireEvent.click(screen.getByRole('button', { name: '새 검색' }));
  await waitFor(() => assert.equal(screen.getByRole('tab', { name: 'CS 동향' }).getAttribute('aria-selected'), 'true'));
});
