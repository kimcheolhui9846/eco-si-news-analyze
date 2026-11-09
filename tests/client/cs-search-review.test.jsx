import 'global-jsdom/register';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../../client/src/App.jsx';
import CsReviewPage from '../../client/src/pages/CsReviewPage.jsx';
import ScopePicker, { CS_SCOPES } from '../../client/src/components/ScopePicker.jsx';
import { createApiClient } from '../../client/src/api/client.js';
import { BUDGET, CS_COLLECT } from './cs-fixtures.js';

afterEach(cleanup);

const makeApi = (over = {}) => ({
  login: async () => ({ token: 't', expiresAt: 'x' }),
  budget: async () => BUDGET,
  collect: async () => CS_COLLECT,
  analyze: async () => ({ analysis: { summary: 'x' }, sources: [], meta: {} }),
  logout: async () => {},
  ...over,
});

const login = async () => {
  fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: /로그인/ }));
  await waitFor(() => assert.ok(screen.getByLabelText(/검색어/)));
};

test('CS 동향 탭을 고르면 종목 입력이 사라지고 CS 범위가 보인다', async () => {
  render(<App api={makeApi()} />);
  await login();
  assert.ok(screen.getByLabelText(/종목 코드/));

  fireEvent.click(screen.getByRole('tab', { name: 'CS 동향' }));

  assert.equal(screen.queryByLabelText(/종목 코드/), null);
  assert.ok(screen.getByRole('checkbox', { name: /커뮤니티/ }));
  assert.ok(screen.getByRole('checkbox', { name: /저장소/ }));
  assert.equal(screen.getByRole('tab', { name: 'CS 동향' }).getAttribute('aria-selected'), 'true');
});

test('CS 검색은 mode: cs로 수집하고 CS 검토 화면을 보인다', async () => {
  let sent = null;
  render(<App api={makeApi({ collect: async (f) => { sent = f; return CS_COLLECT; } })} />);
  await login();
  fireEvent.click(screen.getByRole('tab', { name: 'CS 동향' }));
  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: 'rag' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));

  await waitFor(() => assert.ok(screen.getByText('Sparse MoE for retrieval')));
  assert.equal(sent.mode, 'cs');
  assert.equal(sent.query, 'rag');
  assert.deepEqual(sent.include, ['papers', 'community', 'questions', 'news', 'blogs', 'repos']);
  assert.deepEqual(CS_SCOPES.map((x) => x.value), ['papers', 'community', 'questions', 'news', 'blogs', 'repos']);
});

test('CS 범위는 마지막 하나를 끌 수 없다', () => {
  const changes = [];
  render(<ScopePicker scopes={CS_SCOPES} value={['papers']} onChange={(v) => changes.push(v)} />);
  fireEvent.click(screen.getByRole('checkbox', { name: /논문/ }));
  assert.deepEqual(changes, []);
  fireEvent.click(screen.getByRole('checkbox', { name: /저장소/ }));
  assert.deepEqual(changes, [['papers', 'repos']]);
});

test('CS 검토 화면: 출처 종류별 묶음·사유·승인 값', () => {
  let approved = null;
  render(<CsReviewPage collected={CS_COLLECT} onApprove={(p) => { approved = p; }} onBack={() => {}} busy={false} />);

  assert.ok(screen.getByRole('heading', { name: /논문/ }));
  assert.ok(screen.getByRole('heading', { name: /커뮤니티/ }));
  assert.ok(screen.getByRole('heading', { name: /기술 블로그/ }));
  assert.ok(screen.getByText('A. Kim 외 2명', { exact: false }));
  assert.ok(screen.getByText(/점수 312 · 댓글 87/));
  assert.ok(screen.getByText(/GitHub 검색 한도를 넘었습니다/));
  // 고른 범위는 비어 있어도 보인다.
  assert.ok(screen.getByRole('heading', { name: /저장소/ }));

  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));
  assert.deepEqual(approved, {
    mode: 'cs', newsList: [], papers: CS_COLLECT.papers, community: CS_COLLECT.community,
    questions: CS_COLLECT.questions, blogs: CS_COLLECT.blogs, repos: [], confirmToken: 'ct_cs',
  });
});

const makeFetch = () => {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
};

test('api: CS 수집 본문은 mode·query·lang·include만 담는다', async () => {
  const f = makeFetch();
  await createApiClient({ fetchImpl: f }).collect({ mode: 'cs', query: 'rag', lang: 'en', include: ['papers'], symbol: 'NVDA' });
  assert.deepEqual(JSON.parse(f.calls[0].opts.body), { mode: 'cs', query: 'rag', lang: 'en', include: ['papers'] });
});

test('api: CS 분석 본문은 비어 있지 않은 배열만 담고 확인 토큰을 헤더로 보낸다', async () => {
  const f = makeFetch();
  await createApiClient({ fetchImpl: f }).analyze({
    mode: 'cs', newsList: [], papers: [{ title: 'p' }], community: [{ title: 'h' }], questions: [{ title: 'q' }], blogs: [], repos: undefined,
    confirmToken: 'ct_cs',
  });
  assert.equal(f.calls[0].url, '/api/analyze/news');
  assert.deepEqual(JSON.parse(f.calls[0].opts.body), { mode: 'cs', papers: [{ title: 'p' }], community: [{ title: 'h' }], questions: [{ title: 'q' }] });
  assert.equal(f.calls[0].opts.headers['X-Confirm-Token'], 'ct_cs');
});

test('CS 검토: 개발자 질문과 커뮤니티 사이트 배지를 보인다', () => {
  render(<CsReviewPage collected={CS_COLLECT} onApprove={() => {}} onBack={() => {}} busy={false} />);
  assert.ok(screen.getByRole('heading', { name: /개발자 질문 \(Stack Overflow\) \(1건\)/ }));
  assert.ok(screen.getByText('RAG retriever returns irrelevant chunks'));
  assert.ok(screen.getByText(/점수 7 · 답변 0 · 답 없음 · 조회 605/));
  assert.ok(screen.getByText('python · rag'));
  assert.ok(screen.getByText('Lobsters'));
  assert.ok(screen.getByText('HN'));
});

test('CS 검토: 승인 본문에 질문을 싣는다', () => {
  let payload;
  render(<CsReviewPage collected={CS_COLLECT} onApprove={(p) => { payload = p; }} onBack={() => {}} busy={false} />);
  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));
  assert.equal(payload.questions.length, 1);
});
