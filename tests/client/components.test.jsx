import 'global-jsdom/register';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup } from '@testing-library/react';

import MarketChart from '../../client/src/components/MarketChart.jsx';
import NewsList from '../../client/src/components/NewsList.jsx';
import SourceSummary from '../../client/src/components/SourceSummary.jsx';
import InsightReport from '../../client/src/components/InsightReport.jsx';
import SourceCitation from '../../client/src/components/SourceCitation.jsx';
import ProgressIndicator from '../../client/src/components/ProgressIndicator.jsx';
import ErrorBanner from '../../client/src/components/ErrorBanner.jsx';

// node:test에는 @testing-library의 자동 cleanup이 붙지 않는다.
// 정리하지 않으면 이전 렌더가 DOM에 쌓여 getByText가 중복으로 실패한다.
afterEach(cleanup);

const series = {
  symbol: 'NVDA',
  currency: 'USD',
  points: Array.from({ length: 22 }, (_, i) => ({
    t: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    c: 200 + i,
    v: 1000,
  })),
  indicators: {
    ma5: 218.68, ma20: 219.03, high: 227.98, low: 206.64,
    changePct: 5.23, volatilityPct: 2.8, points: 22,
  },
};

const marketData = {
  assetName: 'NVDA',
  currentPrice: '224.41 USD',
  priceChange: '5.23%',
  chartTrend: '해당 기간 종가는 5.23% 상승했습니다.',
};

const emptyAnalysis = {
  summary: '', newsBriefing: [], trendAnalysis: '', scenarios: [],
  risks: [], monitoringIndicators: [], disclaimer: '면책',
};

// ─── MarketChart ───

test('시계열이 있으면 polyline을 그린다', () => {
  const { container } = render(<MarketChart series={series} marketData={marketData} />);
  assert.ok(container.querySelector('polyline'), '차트 선이 없다');
});

test('점이 20개 이상이면 이동평균 선을 두 개 더 그린다', () => {
  const { container } = render(<MarketChart series={series} marketData={marketData} />);
  assert.equal(container.querySelectorAll('polyline').length, 3);
});

test('점이 적으면 20일선을 그리지 않는다', () => {
  const few = { ...series, points: series.points.slice(0, 6) };
  const { container } = render(<MarketChart series={few} marketData={marketData} />);

  // 종가선 + 5일선만
  assert.equal(container.querySelectorAll('polyline').length, 2);
});

test('시계열이 없으면 자료 부족을 표시하고 죽지 않는다', () => {
  const { container } = render(<MarketChart series={undefined} marketData={undefined} />);

  assert.ok(screen.getByText(/차트를 그릴 가격 데이터가 없습니다/));
  assert.equal(container.querySelector('polyline'), null, '데이터가 없는데 선을 그렸다');
});

test('현재가와 등락률을 표시한다', () => {
  const { container } = render(<MarketChart series={series} marketData={marketData} />);

  assert.match(container.querySelector('.price').textContent, /224\.41/);
  assert.match(container.querySelector('.change').textContent, /5\.23%/);
});

// ─── NewsList ───

test('자료 범위 태그를 표시한다', () => {
  render(<NewsList items={[
    { title: '요약 기사', source: '연합뉴스', url: 'https://a.com/1',
      publishedAt: '2026-09-01T00:00:00.000Z', contentKind: 'summary', content: '본문' },
    { title: '제목만 기사', source: 'IT조선', url: 'https://b.com/2',
      publishedAt: '2026-09-02T00:00:00.000Z', contentKind: 'headline', content: '제목만 기사' },
  ]} />);

  assert.ok(screen.getByText('요약'));
  assert.ok(screen.getByText('제목만'));
});

test('외부 링크에 noopener noreferrer를 붙인다', () => {
  const { container } = render(<NewsList items={[
    { title: 'a', source: 's', url: 'https://a.com/1',
      publishedAt: '2026-09-01T00:00:00.000Z', contentKind: 'summary', content: 'x' },
  ]} />);

  const a = container.querySelector('a[href="https://a.com/1"]');
  assert.ok(a);
  assert.match(a.getAttribute('rel'), /noopener/);
  assert.match(a.getAttribute('rel'), /noreferrer/);
});

test('빈 목록에도 죽지 않는다', () => {
  render(<NewsList items={[]} />);
  assert.ok(screen.getByText(/자료가 없습니다/));
});

// ─── SourceSummary ───

test('수집 요약에 제목만 개수를 드러낸다', () => {
  render(<SourceSummary collected={{
    collectedAt: '2026-09-03T01:00:00.000Z', resolvedSymbol: 'NVDA', symbolSource: 'alias',
    feedsUsed: ['google-news-ko'], newsCount: 8, duplicatesRemoved: 1,
    headlineOnlyCount: 5, degraded: [],
  }} />);

  assert.ok(screen.getByText('5건'), '제목만 개수가 없다');
  assert.ok(screen.getByText(/NVDA/));
});

test('degraded가 있으면 무엇이 빠졌는지 보여준다', () => {
  render(<SourceSummary collected={{
    collectedAt: '2026-09-03T01:00:00.000Z', resolvedSymbol: null, symbolSource: 'unresolved',
    feedsUsed: [], newsCount: 3, duplicatesRemoved: 0, headlineOnlyCount: 0,
    degraded: [{ provider: 'market', reason: '심볼을 해석하지 못했습니다.' }],
  }} />);

  assert.ok(screen.getByText(/심볼을 해석하지 못했습니다/));
});

// ─── InsightReport (XSS) ───

test('LLM 응답에 script가 들어와도 DOM에 태그가 생기지 않는다', () => {
  // LLM 응답은 외부 RSS를 거친 신뢰할 수 없는 입력이다.
  const { container } = render(<InsightReport
    analysis={{ ...emptyAnalysis, summary: '<script>globalThis.__pwned = 1</script>요약입니다' }}
    degraded={false} />);

  assert.equal(container.querySelectorAll('script').length, 0, '스크립트 태그가 생성됐다');
  assert.equal(globalThis.__pwned, undefined, '스크립트가 실행됐다');
  assert.ok(container.textContent.includes('요약입니다'));
});

test('img onerror도 실행되지 않는다', () => {
  const { container } = render(<InsightReport
    analysis={{ ...emptyAnalysis, summary: '<img src=x onerror="globalThis.__xss=1">본문' }}
    degraded={false} />);

  assert.equal(container.querySelectorAll('img').length, 0);
  assert.equal(globalThis.__xss, undefined);
});

test('degraded면 Markdown 폴백을 pre로 표시한다', () => {
  // 렌더러를 붙이면 HTML을 만들고 그 순간 XSS 표면이 생긴다.
  const { container } = render(
    <InsightReport analysis={{ report: '# 제목\n\n본문입니다' }} degraded />,
  );

  assert.ok(container.querySelector('pre'), 'pre로 표시되지 않았다');
  assert.ok(container.textContent.includes('# 제목'));
});

test('degraded면 배너로 알린다', () => {
  render(<InsightReport analysis={{ report: '본문' }} degraded />);
  assert.ok(screen.getByText(/서식이 단순|구조화/));
});

test('시나리오를 카드로 나열한다', () => {
  render(<InsightReport analysis={{
    ...emptyAnalysis,
    summary: '요약',
    trendAnalysis: '동향',
    scenarios: [{
      type: '기본 시나리오', premise: '전제', indicatorsToWatch: '지표',
      possibleDirection: '방향', invalidationCondition: '무효화', cautions: '주의',
    }],
  }} degraded={false} />);

  assert.ok(screen.getByText('기본 시나리오'));
  // 무효화 조건은 시나리오가 틀렸음을 알 수 있게 하는 필수 항목이다.
  assert.ok(screen.getByText('무효화 조건'), '무효화 조건 항목이 없다');
  assert.ok(screen.getByText('무효화'), '무효화 조건 값이 표시되지 않았다');
});

// ─── SourceCitation ───

const oneSource = [{
  sourceId: 'S1', title: '기사', source: '연합뉴스',
  url: 'https://a.com/1', publishedAt: '2026-09-01T00:00:00.000Z',
  collectedAt: '2026-09-03T01:00:00.000Z', type: 'news', relevance: 3,
}];

test('제거된 위조 URL 수를 알린다', () => {
  render(<SourceCitation sources={oneSource}
    meta={{ fabricatedUrlsRemoved: 2, collectedAt: '2026-09-03T01:00:00.000Z' }} />);

  assert.ok(screen.getByText(/출처에 없는 링크 2개/));
});

test('제거된 URL이 없으면 그 문구를 띄우지 않는다', () => {
  render(<SourceCitation sources={oneSource}
    meta={{ fabricatedUrlsRemoved: 0, collectedAt: '2026-09-03T01:00:00.000Z' }} />);

  assert.equal(screen.queryByText(/출처에 없는/), null);
});

// ─── ProgressIndicator ───

test('진행 표시는 두 단계만 쓴다', () => {
  // 원본 요구사항은 7단계지만 실제 호출은 2번이다.
  const a = render(<ProgressIndicator stage="collecting" />);
  assert.ok(a.container.textContent.includes('수집'));
  cleanup();

  const b = render(<ProgressIndicator stage="analyzing" />);
  assert.match(b.container.textContent, /분석|보고서/);
});

// ─── ErrorBanner ───

test('오류에 requestId를 함께 보여준다', () => {
  // 서버 로그와 대조할 수 있는 유일한 단서다.
  render(<ErrorBanner error={{ message: '문제가 생겼습니다', requestId: 'rq-abc123' }} />);

  assert.ok(screen.getByText(/문제가 생겼습니다/));
  assert.ok(screen.getByText(/rq-abc123/));
});

test('requestId가 없어도 죽지 않는다', () => {
  render(<ErrorBanner error={{ message: '오류' }} />);
  assert.ok(screen.getByText(/오류/));
});
