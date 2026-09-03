import MarketChart from '../components/MarketChart.jsx';
import InsightReport from '../components/InsightReport.jsx';
import SourceCitation from '../components/SourceCitation.jsx';
import Disclaimer from '../components/Disclaimer.jsx';

export default function ReportPage({ report, series, marketData, onNewSearch }) {
  if (!report) return null;

  const { analysis, sources, meta } = report;

  return (
    <main className="page">
      {/* 차트가 맨 위. 뉴스와 차트를 대조하는 것이 이 보고서의 핵심이다. */}
      <MarketChart series={series} marketData={marketData} />

      <InsightReport analysis={analysis} degraded={Boolean(meta?.degraded)} />

      <SourceCitation sources={sources} meta={meta} />

      <Disclaimer text={analysis?.disclaimer} />

      <div className="page-actions">
        <button type="button" className="primary" onClick={onNewSearch}>새 검색</button>
      </div>
    </main>
  );
}
