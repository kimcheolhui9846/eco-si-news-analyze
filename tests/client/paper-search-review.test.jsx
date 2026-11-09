import 'global-jsdom/register';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../../client/src/App.jsx';
import PaperReviewPage from '../../client/src/pages/PaperReviewPage.jsx';
import { arxivIdFrom } from '../../client/src/lib/arxiv.js';
import { createApiClient } from '../../client/src/api/client.js';
import { messageForError } from '../../client/src/api/errors.js';
import { PAPER_COLLECT } from './paper-fixtures.js';
import { BUDGET } from './cs-fixtures.js';

afterEach(cleanup);

const makeApi = (over = {}) => ({
  login: async () => ({ token: 't', expiresAt: 'x' }),
  budget: async () => BUDGET,
  collect: async () => PAPER_COLLECT,
  analyze: async () => ({ analysis: { summary: 'x' }, sources: [], meta: {} }),
  logout: async () => {},
  ...over,
});

const login = async () => {
  fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: /로그인/ }));
  await waitFor(() => assert.ok(screen.getByRole('tab', { name: '논문 전문' })));
};

test('arxivIdFrom: 서버와 같은 규칙', () => {
  assert.equal(arxivIdFrom('https://arxiv.org/pdf/2401.04088v2.pdf'), '2401.04088v2');
  assert.equal(arxivIdFrom(' arXiv:2401.04088 '), '2401.04088');
  assert.equal(arxivIdFrom('hep-th/9901001'), 'hep-th/9901001');
  assert.equal(arxivIdFrom('https://evil.com/abs/2401.04088'), null);
  assert.equal(arxivIdFrom('hello'), null);
  assert.equal(arxivIdFrom(undefined), null);
});

test('논문 전문 탭: 형식이 맞아야 수집 버튼이 켜지고, 고른 값으로 수집한다', async () => {
  const calls = [];
  render(<App api={makeApi({ collect: async (form) => { calls.push(form); return PAPER_COLLECT; } })} />);
  await login();
  fireEvent.click(screen.getByRole('tab', { name: '논문 전문' }));

  assert.ok(screen.getByRole('heading', { name: '어떤 논문을 읽을까요?' }));
  const input = screen.getByLabelText('arXiv ID 또는 링크');
  const submit = screen.getByRole('button', { name: '본문 가져오기' });
  assert.equal(submit.disabled, true);
  fireEvent.change(input, { target: { value: 'not an id' } });
  assert.equal(submit.disabled, true);
  fireEvent.change(input, { target: { value: 'https://arxiv.org/abs/2611.00001' } });
  assert.equal(submit.disabled, false);
  fireEvent.click(submit);

  await waitFor(() => assert.ok(screen.getByText('Tiny MoE Retrieval')));
  assert.deepEqual(calls, [{ mode: 'paper', arxiv: 'https://arxiv.org/abs/2611.00001' }]);
});

test('검토 화면: 장 목차·잘림 표시·예상 비용, 승인하면 paper를 그대로 넘긴다', () => {
  const approved = [];
  render(<PaperReviewPage collected={PAPER_COLLECT} onApprove={(p) => approved.push(p)} onBack={() => {}} busy={false} />);

  assert.ok(screen.getByText('Tiny MoE Retrieval'));
  assert.ok(screen.getByText('Ada Lovelace, Alan Turing'));
  assert.equal(screen.getByRole('link', { name: 'arXiv 원문' }).getAttribute('href'), 'https://arxiv.org/abs/2611.00001');
  assert.ok(screen.getByText(/본문이 길어 일부 장은 분석에서 빠지거나 잘립니다/));
  assert.ok(screen.getByText('일부만'));
  assert.ok(screen.getByText('제외'));
  assert.ok(screen.getByText(/약 30,000토큰/));
  assert.ok(screen.getByText('$0.0950'));

  fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));
  assert.deepEqual(approved, [{ mode: 'paper', paper: PAPER_COLLECT.paper, confirmToken: 'ct_paper' }]);
});

test('api: 논문 수집·분석 본문', async () => {
  const sent = [];
  const fetchImpl = async (path, opts) => {
    sent.push({ path, body: JSON.parse(opts.body), headers: opts.headers });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const api = createApiClient({ fetchImpl });
  await api.collect({ mode: 'paper', arxiv: '2611.00001' });
  await api.analyze({ mode: 'paper', paper: PAPER_COLLECT.paper, confirmToken: 'ct_paper' });

  assert.deepEqual(sent[0].body, { mode: 'paper', arxiv: '2611.00001' });
  assert.equal(sent[1].path, '/api/analyze/news');
  assert.deepEqual(sent[1].body, { mode: 'paper', paper: PAPER_COLLECT.paper });
  assert.equal(sent[1].headers['X-Confirm-Token'], 'ct_paper');
});

test('HTML 판이 없다는 오류는 서버 문구를 쓰고 검색 화면으로 돌아간다', () => {
  const mapped = messageForError({ code: 'FULLTEXT_UNAVAILABLE', message: '이 논문은 arXiv HTML 판이 없어 전문 분석을 할 수 없습니다.' });
  assert.equal(mapped.message, '이 논문은 arXiv HTML 판이 없어 전문 분석을 할 수 없습니다.');
  assert.equal(mapped.nextStep, 'search');
});
