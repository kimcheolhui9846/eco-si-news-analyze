import 'global-jsdom/register';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

import LoginPage from '../../client/src/pages/LoginPage.jsx';
import ReviewPage from '../../client/src/pages/ReviewPage.jsx';
import ReportPage from '../../client/src/pages/ReportPage.jsx';

afterEach(cleanup);

const COLLECTED = {
  newsList: [
    { title: '엔비디아 실적', content: '본문입니다', source: '연합뉴스',
      url: 'https://a.com/1', publishedAt: '2026-09-01T00:00:00.000Z', contentKind: 'summary' },
    { title: '제목만 기사', content: '제목만 기사', source: 'IT조선',
      url: 'https://b.com/2', publishedAt: '2026-09-02T00:00:00.000Z', contentKind: 'headline' },
  ],
  instruments: [{
    symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', market: 'US',
    marketData: {
      assetName: 'NVDA', currentPrice: '224.41 USD',
      priceChange: '5.23%', chartTrend: '상승했습니다.',
    },
    series: {
      symbol: 'NVDA',
      currency: 'USD',
      points: Array.from({ length: 22 }, (_, i) => ({
        t: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, c: 200 + i, v: 1,
      })),
      indicators: { ma5: 218, ma20: 219, high: 221, low: 200, changePct: 5.23, volatilityPct: 2.8, points: 22 },
    },
  }],
  collected: {
    collectedAt: '2026-09-03T01:00:00.000Z', resolution: { kind: 'explicit', symbols: ['NVDA'] },
    feedsUsed: ['google-news-ko'], newsCount: 2, duplicatesRemoved: 0,
    headlineOnlyCount: 1, degraded: [],
  },
  estimate: {
    estimatedInputTokens: 1292, assumedOutputTokens: 2000, estimatedCostUsd: 0.02323,
    budget: {
      calls: { used: 3, limit: 50, remaining: 47 },
      cost: { usedUsd: 0.31, limitUsd: 5, remainingUsd: 4.69 },
    },
  },
  confirmToken: 'ct_abc',
};

const emptyReport = (over = {}) => ({
  analysis: {
    summary: '요약', newsBriefing: [], trendAnalysis: '', scenarios: [],
    risks: [], monitoringIndicators: [], disclaimer: '면책',
    ...over.analysis,
  },
  sources: [],
  meta: { degraded: false, fabricatedUrlsRemoved: 0, collectedAt: '2026-09-03T01:00:00.000Z', ...over.meta },
});

// ─── LoginPage ───

test('비밀번호를 입력해 로그인하면 성공 콜백이 불린다', async () => {
  let called = null;
  const api = { login: async (pw) => { called = pw; return { token: 't' }; } };
  render(<LoginPage api={api} onSuccess={() => {}} />);

  fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: /로그인/ }));

  await waitFor(() => assert.equal(called, 'secret'));
});

test('로그인 실패 시 메시지를 보여주고 화면을 옮기지 않는다', async () => {
  const api = { login: async () => { throw { code: 'INVALID_CREDENTIALS' }; } };
  let moved = false;
  render(<LoginPage api={api} onSuccess={() => { moved = true; }} />);

  fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: /로그인/ }));

  await waitFor(() => assert.ok(screen.getByText(/비밀번호가 올바르지 않습니다/)));
  assert.equal(moved, false);
});

// ─── ReviewPage — 승인 지점 ───

test('검토 화면이 예상 비용과 남은 예산을 보여준다', () => {
  const { container } = render(
    <ReviewPage collected={COLLECTED} onApprove={() => {}} onBack={() => {}} busy={false} />,
  );

  const bar = container.querySelector('.sticky-bar');
  assert.match(bar.textContent, /0\.0232/, '예상 비용이 없다');
  assert.match(bar.textContent, /3\/50/, '사용량이 없다');
});

test('검토 화면이 제목만 확보된 개수를 경고로 보여준다', () => {
  // 승인 전에 보여야 의미가 있다. 제목뿐인 자료로 만든 분석을
  // 전문 분석으로 오해하면 결론을 과신하게 된다.
  const { container } = render(
    <ReviewPage collected={COLLECTED} onApprove={() => {}} onBack={() => {}} busy={false} />,
  );

  const warn = container.querySelector('.sticky-bar .warn');
  assert.ok(warn, '경고 문구가 없다');
  assert.match(warn.textContent, /2건 중 1건은 제목만/);
});

test('승인 버튼을 누르면 확인 토큰과 함께 콜백이 불린다', () => {
  let got = null;
  render(<ReviewPage collected={COLLECTED} onApprove={(v) => { got = v; }} onBack={() => {}} busy={false} />);

  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));

  assert.equal(got.confirmToken, 'ct_abc');
  assert.deepEqual(got.newsList, COLLECTED.newsList, 'newsList가 변형됐다');
  assert.deepEqual(got.instruments, COLLECTED.instruments);
});

test('처리 중이면 승인 버튼이 비활성화된다', () => {
  render(<ReviewPage collected={COLLECTED} onApprove={() => {}} onBack={() => {}} busy />);
  assert.equal(screen.getByRole('button', { name: /분석 중/ }).disabled, true);
});

test('수집된 자료 목록을 보여준다', () => {
  render(<ReviewPage collected={COLLECTED} onApprove={() => {}} onBack={() => {}} busy={false} />);

  assert.ok(screen.getByText('엔비디아 실적'));
  assert.ok(screen.getByText('제목만 기사'));
});

// ─── ReportPage ───

test('보고서 화면이 차트를 맨 위에 둔다', () => {
  const { container } = render(
    <ReportPage report={emptyReport()} instruments={COLLECTED.instruments} onNewSearch={() => {}} />,
  );

  const cards = [...container.querySelectorAll('.card')];
  assert.ok(cards[0].querySelector('svg.chart'), '차트가 맨 위가 아니다');
});

test('보고서 화면에 면책 문구가 있다', () => {
  render(
    <ReportPage report={emptyReport({ analysis: { disclaimer: '투자 권유가 아닙니다.' } })}
      instruments={[]} onNewSearch={() => {}} />,
  );

  assert.ok(screen.getByText(/투자 권유가 아닙니다/));
});

test('새 검색 버튼이 콜백을 부른다', () => {
  let clicked = false;
  render(
    <ReportPage report={emptyReport()} instruments={[]}
      onNewSearch={() => { clicked = true; }} />,
  );

  fireEvent.click(screen.getByRole('button', { name: /새 검색/ }));
  assert.equal(clicked, true);
});
