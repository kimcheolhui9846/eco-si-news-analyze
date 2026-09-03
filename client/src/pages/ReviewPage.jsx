import SourceSummary from '../components/SourceSummary.jsx';
import NewsList from '../components/NewsList.jsx';
import { formatUsd } from '../lib/format.js';

export default function ReviewPage({ collected, onApprove, onBack, busy }) {
  if (!collected) return null;

  const { newsList, marketData, collected: meta, estimate, confirmToken } = collected;
  const headlineOnly = meta?.headlineOnlyCount ?? 0;

  return (
    <main className="page has-sticky">
      <header className="page-head">
        <h1>수집한 자료를 확인해 주세요</h1>
        <button type="button" className="link" onClick={onBack}>검색으로</button>
      </header>

      <SourceSummary collected={meta} />

      {marketData && (
        <section className="card">
          <h2 className="card-title">시장 데이터</h2>
          <p>
            <strong>{marketData.assetName}</strong> {marketData.currentPrice}
            {' '}<span className="change">{marketData.priceChange}</span>
          </p>
          <p className="muted small">{marketData.chartTrend}</p>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">수집된 뉴스</h2>
        <NewsList items={newsList} />
      </section>

      {/* 승인 바. 스크롤해도 화면 아래 붙어 있다. */}
      <div className="sticky-bar">
        <div className="sticky-info">
          <span>
            예상 비용 <strong>{formatUsd(estimate?.estimatedCostUsd)}</strong>
            {estimate?.budget && (
              <> · 오늘 {estimate.budget.calls.used}/{estimate.budget.calls.limit}회 사용</>
            )}
          </span>
          {/* 승인 전에 보여야 의미가 있다. 제목뿐인 자료로 만든 분석을
              전문 분석으로 오해하면 결론을 과신하게 된다. */}
          {headlineOnly > 0 && (
            <span className="warn small">
              {newsList.length}건 중 {headlineOnly}건은 제목만 확보 — 본문 없이 분석합니다
            </span>
          )}
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => onApprove({ newsList, marketData, confirmToken })}
        >
          {busy ? '분석 중…' : '분석 시작'}
        </button>
      </div>
    </main>
  );
}
