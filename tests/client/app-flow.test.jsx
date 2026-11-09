import 'global-jsdom/register';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../../client/src/App.jsx';

afterEach(cleanup);

const BUDGET = {
  calls: { used: 0, limit: 50, remaining: 50, resetsAt: '2026-09-04T00:00:00.000Z' },
  cost: { usedUsd: 0, limitUsd: 5, remainingUsd: 5, resetsAt: '2026-10-01T00:00:00.000Z' },
};

const COLLECT_RESULT = {
  newsList: [{
    title: '기사', content: '본문', source: '연합뉴스',
    url: 'https://a.com/1', publishedAt: '2026-09-01T00:00:00.000Z', contentKind: 'summary',
  }],
  instruments: [{
    symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', market: 'US',
    marketData: { assetName: 'NVDA', currentPrice: '224.41 USD', priceChange: '5.23%', chartTrend: '상승' },
    series: {
      symbol: 'NVDA', currency: 'USD',
      points: [{ t: '2026-09-01T00:00:00.000Z', c: 1 }, { t: '2026-09-02T00:00:00.000Z', c: 2 }],
      indicators: {},
    },
  }],
  collected: {
    collectedAt: '2026-09-03T01:00:00.000Z', resolution: { kind: 'explicit', symbols: ['NVDA'] },
    feedsUsed: ['google-news-ko'], newsCount: 1, duplicatesRemoved: 0,
    headlineOnlyCount: 0, degraded: [],
  },
  estimate: { estimatedInputTokens: 100, estimatedCostUsd: 0.001, budget: BUDGET },
  confirmToken: 'ct_xyz',
};

const REPORT = {
  analysis: {
    summary: '분석 요약입니다', newsBriefing: [], trendAnalysis: '',
    scenarios: [], risks: [], monitoringIndicators: [], disclaimer: '면책',
  },
  sources: [],
  meta: { degraded: false, fabricatedUrlsRemoved: 0, collectedAt: '2026-09-03T01:00:00.000Z' },
};

const makeApi = (over = {}) => ({
  login: async () => ({ token: 't', expiresAt: 'x' }),
  budget: async () => BUDGET,
  collect: async () => COLLECT_RESULT,
  analyze: async () => REPORT,
  logout: async () => {},
  ...over,
});

const login = async () => {
  fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: /로그인/ }));
  await waitFor(() => screen.getByLabelText(/검색어/));
};

const collectAndWait = async () => {
  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: '엔비디아' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));
  await waitFor(() => screen.getByRole('button', { name: /분석 시작/ }));
};

test('로그인하면 검색 화면으로 넘어간다', async () => {
  render(<App api={makeApi()} />);
  await login();

  assert.ok(screen.getByLabelText(/검색어/));
});

test('검색하면 검토 화면으로 넘어간다', async () => {
  render(<App api={makeApi()} />);
  await login();
  await collectAndWait();

  assert.ok(screen.getByRole('button', { name: /분석 시작/ }));
});

test('승인하면 보고서 화면으로 넘어간다', async () => {
  render(<App api={makeApi()} />);
  await login();
  await collectAndWait();

  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));
  await waitFor(() => assert.ok(screen.getByText('분석 요약입니다')));
});

test('분석에 확인 토큰과 원본 newsList가 그대로 전달된다', async () => {
  // 한 글자만 바뀌어도 cacheKey가 달라져 428이 난다.
  let sent = null;
  render(<App api={makeApi({ analyze: async (a) => { sent = a; return REPORT; } })} />);
  await login();
  await collectAndWait();

  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));

  await waitFor(() => assert.ok(sent));
  assert.equal(sent.confirmToken, 'ct_xyz');
  assert.deepEqual(sent.newsList, COLLECT_RESULT.newsList);
});

test('세션 만료(403)는 로그인 화면으로 되돌린다', async () => {
  render(<App api={makeApi({ collect: async () => { throw { code: 'FORBIDDEN' }; } })} />);
  await login();

  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: '엔비디아' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));

  await waitFor(() => assert.ok(screen.getByLabelText(/비밀번호/)));
});

test('상류 오류는 검토 화면을 유지해 재시도할 수 있게 한다', async () => {
  // 수집 결과와 확인 토큰이 아직 유효하므로 무료인 수집을 다시 할 이유가 없다.
  render(<App api={makeApi({ analyze: async () => { throw { code: 'UPSTREAM_TIMEOUT' }; } })} />);
  await login();
  await collectAndWait();

  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));

  await waitFor(() => assert.ok(screen.getByText(/지연되었습니다/)));
  assert.ok(screen.getByRole('button', { name: /분석 시작/ }), '검토 화면을 벗어났다');
});

test('수집 실패는 검색 화면을 유지한다', async () => {
  render(<App api={makeApi({
    collect: async () => {
      throw { code: 'COLLECTION_FAILED', message: '분석할 뉴스를 수집하지 못했습니다.' };
    },
  })} />);
  await login();

  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: '없는주제' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));

  await waitFor(() => assert.ok(screen.getByText(/수집하지 못했습니다/)));
  assert.ok(screen.getByLabelText(/검색어/), '검색 화면을 벗어났다');
});

test('수집 중에는 진행 표시가 나온다', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  render(<App api={makeApi({ collect: async () => { await gate; return COLLECT_RESULT; } })} />);
  await login();

  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: '엔비디아' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));

  await waitFor(() => assert.ok(screen.getByText(/수집하고 있습니다/)));
  release();
});

test('새 검색을 누르면 검색 화면으로 돌아간다', async () => {
  render(<App api={makeApi()} />);
  await login();
  await collectAndWait();

  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));
  await waitFor(() => screen.getByText('분석 요약입니다'));

  fireEvent.click(screen.getByRole('button', { name: /새 검색/ }));
  await waitFor(() => assert.ok(screen.getByLabelText(/검색어/)));
});

test('예산이 소진되면 검색을 막는다', async () => {
  // 수집까지 한 뒤 막히는 것보다 여기서 막는 편이 낫다.
  const empty = { ...BUDGET, calls: { ...BUDGET.calls, remaining: 0 } };
  render(<App api={makeApi({ budget: async () => empty })} />);
  await login();

  await waitFor(() => assert.ok(screen.getByText(/예산을 모두 사용했습니다/)));
  assert.equal(screen.getByRole('button', { name: /자료 수집/ }).disabled, true);
});
