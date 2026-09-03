import RiskPanel from './RiskPanel.jsx';
import MonitoringIndicators from './MonitoringIndicators.jsx';

export default function InsightReport({ analysis, degraded }) {
  if (!analysis) return null;

  // 구조화 출력이 실패하면 Markdown 문자열 하나만 온다.
  // 렌더러를 붙이지 않고 pre로 표시한다 — 렌더러는 HTML을 만들고
  // 그 순간 XSS 표면이 생긴다. LLM 응답은 외부 RSS를 거친 신뢰할 수 없는 입력이다.
  if (degraded) {
    return (
      <>
        <div className="banner warn-banner">
          구조화 출력이 실패해 서식이 단순합니다. 내용은 그대로입니다.
        </div>
        <section className="card">
          <pre className="fallback-report">{analysis.report}</pre>
        </section>
      </>
    );
  }

  return (
    <>
      {analysis.summary && (
        <section className="card">
          <h2 className="card-title">핵심 요약</h2>
          <p>{analysis.summary}</p>
        </section>
      )}

      {analysis.newsBriefing?.length > 0 && (
        <section className="card">
          <h2 className="card-title">뉴스 브리핑</h2>
          {analysis.newsBriefing.map((b) => (
            <article key={b.sourceId} className="briefing">
              <div className="briefing-head">
                <span className="cite">{b.sourceId}</span>
                <strong>{b.title}</strong>
              </div>
              <div className="muted small">{b.source} · {b.publishedAt}</div>
              <p>{b.keyPoints}</p>
              <p className="muted">시장·기술적 의미: {b.marketImplication}</p>
              <p className="muted">확인 필요: {b.needsVerification}</p>
            </article>
          ))}
        </section>
      )}

      {analysis.trendAnalysis && (
        <section className="card">
          <h2 className="card-title">차트와 뉴스의 동향 비교</h2>
          <p>{analysis.trendAnalysis}</p>
        </section>
      )}

      {analysis.scenarios?.length > 0 && (
        <section className="card">
          <h2 className="card-title">투자 시나리오</h2>
          <div className="scenarios">
            {analysis.scenarios.map((s) => (
              <article key={s.type} className="scenario">
                <h3>{s.type}</h3>
                <dl>
                  <dt>전제</dt><dd>{s.premise}</dd>
                  <dt>확인할 지표</dt><dd>{s.indicatorsToWatch}</dd>
                  <dt>가능한 방향</dt><dd>{s.possibleDirection}</dd>
                  <dt>무효화 조건</dt><dd>{s.invalidationCondition}</dd>
                  <dt>주의할 점</dt><dd>{s.cautions}</dd>
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}

      <RiskPanel risks={analysis.risks} />
      <MonitoringIndicators indicators={analysis.monitoringIndicators} />
    </>
  );
}
