import MarketChart from '../components/MarketChart.jsx';
import InsightReport from '../components/InsightReport.jsx';
import SourceCitation from '../components/SourceCitation.jsx';
import FinancialMetrics from '../components/FinancialMetrics.jsx';
import ResearchList from '../components/ResearchList.jsx';
import ExperimentStatus from '../components/ExperimentStatus.jsx';
import Disclaimer from '../components/Disclaimer.jsx';

export default function ReportPage({
  report, series, marketData,
  financial, research, experiments, collectedMeta,
  onNewSearch,
}) {
  if (!report) return null;

  // report.meta는 분석 메타(비용·모델), collectedMeta는 수집 메타(범위·사유)다.
  const { analysis, sources, meta } = report;

  return (
    <main className="page">
      {/* 차트가 맨 위. 뉴스와 차트를 대조하는 것이 이 보고서의 핵심이다. */}
      <MarketChart series={series} marketData={marketData} />

      <InsightReport analysis={analysis} degraded={Boolean(meta?.degraded)} />

      {/* 선택한 범위는 비어 있어도 렌더링한다. 감추면 자료가 존재하지
          않는다고 오해한다. */}
      {collectedMeta?.included?.includes('financial') && (
        <FinancialMetrics financial={financial} collected={collectedMeta} />
      )}
      {collectedMeta?.included?.includes('research') && (
        <ResearchList items={research} collected={collectedMeta} />
      )}
      {collectedMeta?.included?.includes('experiments') && (
        <ExperimentStatus items={experiments} collected={collectedMeta} />
      )}

      <SourceCitation sources={sources} meta={meta} />

      <Disclaimer text={analysis?.disclaimer} />

      <div className="page-actions">
        <button type="button" className="primary" onClick={onNewSearch}>새 검색</button>
      </div>
    </main>
  );
}
