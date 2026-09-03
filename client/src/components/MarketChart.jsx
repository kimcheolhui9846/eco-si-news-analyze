import { buildChartGeometry, movingAverageLine } from '../lib/chart.js';

const BOX = { width: 640, height: 200, padding: 12 };

export default function MarketChart({ series, marketData }) {
  const points = series?.points;
  const geometry = buildChartGeometry(points, BOX);

  if (!geometry) {
    return (
      <section className="card">
        <h2 className="card-title">시장 데이터</h2>
        <p className="muted">자료 부족 — 차트를 그릴 가격 데이터가 없습니다.</p>
      </section>
    );
  }

  // 데이터가 모자라면 해당 이동평균을 그리지 않는다.
  // 없는 지표를 그리면 있는 것처럼 보여주게 된다.
  const ma5 = movingAverageLine(points, 5, geometry);
  const ma20 = movingAverageLine(points, 20, geometry);

  return (
    <section className="card">
      <div className="chart-head">
        <h2 className="card-title">{series.symbol}</h2>
        {marketData && (
          <div>
            <strong className="price">{marketData.currentPrice}</strong>
            <span className="change">{marketData.priceChange}</span>
          </div>
        )}
      </div>

      <svg
        className="chart"
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${series.symbol} 가격 추이 차트`}
      >
        <polyline className="chart-line" points={geometry.line} fill="none" />
        {ma5 && <polyline className="chart-ma5" points={ma5} fill="none" />}
        {ma20 && <polyline className="chart-ma20" points={ma20} fill="none" />}
      </svg>

      <div className="chart-legend">
        <span className="legend-line" /> 종가
        {ma5 && <><span className="legend-ma5" /> 5일</>}
        {ma20 && <><span className="legend-ma20" /> 20일</>}
        <span className="muted">
          최고 {geometry.max.toLocaleString()} · 최저 {geometry.min.toLocaleString()} {series.currency}
        </span>
      </div>

      {marketData?.chartTrend && <p className="trend">{marketData.chartTrend}</p>}
    </section>
  );
}
