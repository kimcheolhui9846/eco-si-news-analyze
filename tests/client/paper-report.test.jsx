import 'global-jsdom/register';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import App from '../../client/src/App.jsx';
import PaperReportPage from '../../client/src/pages/PaperReportPage.jsx';
import CsReportPage from '../../client/src/pages/CsReportPage.jsx';
import { PAPER_COLLECT, PAPER_REPORT } from './paper-fixtures.js';
import { BUDGET, CS_COLLECT } from './cs-fixtures.js';

afterEach(cleanup);

test('논문 보고서: 섹션을 순서대로 그리고 수치·심각도를 표시한다', () => {
  render(<PaperReportPage report={PAPER_REPORT} paper={PAPER_COLLECT.paper} onNewSearch={() => {}} />);

  const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  assert.deepEqual(headings.slice(0, 9), [
    '핵심 요약', '풀려는 문제', '방법', '실험 설정', '핵심 결과',
    '저자가 밝힌 한계', '리뷰어 시각의 약점', '재현성', '남은 질문',
  ]);
  assert.ok(screen.getByText('Tiny MoE Retrieval'));
  assert.ok(screen.getByText('BM25보다 재현율이 높다'));
  assert.ok(screen.getByText('85.3'));
  assert.ok(screen.getByText('71.2'));
  assert.ok(screen.getByText('중요'));
  assert.ok(screen.getByText(/코드: 언급 없음/));
  assert.ok(screen.getByText(/데이터: 공개/));
  assert.ok(screen.getByText('다른 도메인에서도 유지되는가?'));
});

test('논문 보고서: 잘린 장을 머리에 알린다', () => {
  render(<PaperReportPage report={PAPER_REPORT} paper={PAPER_COLLECT.paper} onNewSearch={() => {}} />);
  const notice = screen.getByText(/길이 제한으로 분석에서 빠지거나 잘린 장/);
  assert.ok(notice.textContent.includes('3 Experiments(일부)'));
  assert.ok(notice.textContent.includes('Acknowledgements'));
});

test('논문 보고서: 인용을 누르면 장 제목과 본문 앞부분을 펼친다', () => {
  render(<PaperReportPage report={PAPER_REPORT} paper={PAPER_COLLECT.paper} onNewSearch={() => {}} />);
  const problem = screen.getByRole('heading', { name: '풀려는 문제' }).closest('section');
  fireEvent.click(within(problem).getByRole('button', { name: 'S1' }));
  assert.ok(within(problem).getByText('1 Introduction'));
  assert.ok(within(problem).getByText('Dense retrievers are costly.'));
  fireEvent.click(within(problem).getByRole('button', { name: 'S1' }));
  assert.equal(within(problem).queryByText('Dense retrievers are costly.'), null);
});

test('논문 보고서: 구조화 응답이 없으면 본문만 보여 준다', () => {
  const report = { ...PAPER_REPORT, analysis: { report: '마크다운 본문' }, meta: { ...PAPER_REPORT.meta, degraded: true } };
  render(<PaperReportPage report={report} paper={PAPER_COLLECT.paper} onNewSearch={() => {}} />);
  assert.ok(screen.getByText('마크다운 본문'));
});

const CS_REPORT = {
  analysis: {
    summary: 's', keyDevelopments: [], communityPulse: '', openSourceSignals: [], developerPainPoints: [],
    openQuestions: [], whatToWatch: [], sourceCoverage: { level: '부분적', note: 'n' },
    paperHighlights: [
      { sourceId: 'P1', contribution: 'c', method: 'm', limitations: 'l' },
      { sourceId: 'P2', contribution: 'c2', method: 'm2', limitations: 'l2' },
    ],
  },
  sources: [
    { sourceId: 'P1', title: 'Sparse MoE', source: 'arXiv (cs.CL)', url: 'https://arxiv.org/abs/2611.00001v1', type: 'paper' },
    { sourceId: 'P2', title: 'No link', source: 'arXiv', url: 'https://example.com/x', type: 'paper' },
  ],
  meta: { quality: { score: 100, fixed: 0, warnings: 0, issues: [], limited: false }, degraded: false },
};

test('CS 보고서: arXiv 링크가 있는 논문에만 전문 분석 버튼이 있고 ID를 넘긴다', () => {
  const picked = [];
  render(<CsReportPage report={CS_REPORT} onNewSearch={() => {}} onDeepAnalyze={(id) => picked.push(id)} />);
  const buttons = screen.getAllByRole('button', { name: '전문 분석' });
  assert.equal(buttons.length, 1);
  fireEvent.click(buttons[0]);
  assert.deepEqual(picked, ['2611.00001v1']);
});

test('CS 보고서 → 전문 분석: 논문 탭으로 바꿔 수집하고 검토 화면을 연다', async () => {
  const collects = [];
  const api = {
    login: async () => ({ token: 't', expiresAt: 'x' }),
    budget: async () => BUDGET,
    collect: async (form) => { collects.push(form); return form.mode === 'paper' ? PAPER_COLLECT : CS_COLLECT; },
    analyze: async () => CS_REPORT,
    logout: async () => {},
  };
  render(<App api={api} />);
  fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: /로그인/ }));
  await waitFor(() => assert.ok(screen.getByRole('tab', { name: 'CS 동향' })));
  fireEvent.click(screen.getByRole('tab', { name: 'CS 동향' }));
  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: 'moe' } });
  fireEvent.click(screen.getByRole('button', { name: '자료 수집' }));
  await waitFor(() => assert.ok(screen.getByRole('button', { name: '분석 시작' })));
  fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));
  await waitFor(() => assert.ok(screen.getByRole('button', { name: '전문 분석' })));

  fireEvent.click(screen.getByRole('button', { name: '전문 분석' }));
  await waitFor(() => assert.ok(screen.getByText('읽을 논문을 확인해 주세요')));
  assert.deepEqual(collects.at(-1), { mode: 'paper', arxiv: '2611.00001v1' });
});

test('CS 보고서 → 전문 분석 수집이 실패하면 CS 보고서로 돌아오고 오류를 보여 준다', async () => {
  const api = {
    login: async () => ({ token: 't', expiresAt: 'x' }),
    budget: async () => BUDGET,
    collect: async (form) => {
      if (form.mode === 'paper') throw { code: 'FULLTEXT_UNAVAILABLE', message: '이 논문은 arXiv HTML 판이 없어 전문 분석을 할 수 없습니다.' };
      return CS_COLLECT;
    },
    analyze: async () => CS_REPORT,
    logout: async () => {},
  };
  render(<App api={api} />);
  fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: /로그인/ }));
  await waitFor(() => assert.ok(screen.getByRole('tab', { name: 'CS 동향' })));
  fireEvent.click(screen.getByRole('tab', { name: 'CS 동향' }));
  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: 'moe' } });
  fireEvent.click(screen.getByRole('button', { name: '자료 수집' }));
  await waitFor(() => assert.ok(screen.getByRole('button', { name: '분석 시작' })));
  fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));
  await waitFor(() => assert.ok(screen.getByRole('button', { name: '전문 분석' })));

  fireEvent.click(screen.getByRole('button', { name: '전문 분석' }));
  await waitFor(() => assert.ok(screen.getByText(/arXiv HTML 판이 없어/)));
  // CS 보고서가 그대로 남아 있다.
  assert.ok(screen.getByRole('button', { name: '전문 분석' }));
  assert.equal(screen.queryByLabelText(/검색어/), null);
});
