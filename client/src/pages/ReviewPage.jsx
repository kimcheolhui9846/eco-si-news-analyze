import SourceSummary from '../components/SourceSummary.jsx';
import NewsList from '../components/NewsList.jsx';
import InstrumentComparison from '../components/InstrumentComparison.jsx';
import FinancialMetrics from '../components/FinancialMetrics.jsx';
import ResearchList from '../components/ResearchList.jsx';
import ExperimentStatus from '../components/ExperimentStatus.jsx';
import { formatUsd } from '../lib/format.js';

export default function ReviewPage({ collected, onApprove, onBack, busy }) {
  if (!collected) return null;

  const {
    newsList, instruments = [], research, experiments,
    collected: meta, estimate, confirmToken,
  } = collected;
  const sector = meta?.resolution?.sector;
  const single = instruments.length === 1 ? instruments[0] : null;
  const headlineOnly = meta?.headlineOnlyCount ?? 0;

  return (
    <main className="page has-sticky">
      <header className="page-head">
        <h1>수집한 자료를 확인해 주세요</h1>
        <button type="button" className="link" onClick={onBack}>검색으로</button>
      </header>

      <SourceSummary collected={meta} />

      {instruments.length > 1 && (
        <InstrumentComparison instruments={instruments} resolution={meta?.resolution} degraded={meta?.degraded} />
      )}
      {single?.marketData && (
        <section className="card">
          <h2 className="card-title">시장 데이터</h2>
          <p>
            <strong>{single.name}</strong> {single.marketData.currentPrice}
            {' '}<span className="change">{single.marketData.priceChange}</span>
          </p>
          <p className="muted small">{single.marketData.chartTrend}</p>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">수집된 뉴스</h2>
        <NewsList items={newsList} />
      </section>

      {/* 선택한 범위는 비어 있어도 렌더링한다. 감추면 자료가 존재하지
          않는다고 오해한다. */}
      {meta?.included?.includes('financial') && instruments.length <= 1 && (
        <FinancialMetrics financial={single?.financial} collected={meta} />
      )}
      {meta?.included?.includes('research') && (
        <ResearchList items={research} collected={meta} />
      )}
      {meta?.included?.includes('experiments') && (
        <ExperimentStatus items={experiments} collected={meta} />
      )}

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
          onClick={() => onApprove({
            newsList, instruments, sector, research, experiments, confirmToken,
          })}
        >
          {busy ? '분석 중…' : '분석 시작'}
        </button>
      </div>
    </main>
  );
}
