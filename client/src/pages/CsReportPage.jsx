import QualityBadge from '../components/QualityBadge.jsx';
import SourceCitation from '../components/SourceCitation.jsx';

// 모든 문자열은 텍스트로만 그린다. 모델 출력을 HTML로 해석하지 않는다.

const NO_DATA = '자료 없음';

function Section({ title, children }) {
  return (
    <section className="card">
      <h2 className="card-title">{title}</h2>
      {children}
    </section>
  );
}

const Empty = () => <p className="muted">{NO_DATA}</p>;

const TextList = ({ items }) => (items?.length
  ? <ul>{items.map((text, i) => <li key={i}>{text}</li>)}</ul>
  : <Empty />);

const Cites = ({ ids }) => (ids?.length
  ? <span className="cites">{ids.map((id, i) => <span key={`${id}-${i}`} className="cite">{id}</span>)}</span>
  : <span className="muted small">근거 출처 없음</span>);

const Labeled = ({ label, children }) => (
  <p><span className="muted small">{label}</span> {children}</p>
);

export default function CsReportPage({ report, onNewSearch }) {
  if (!report) return null;

  const { analysis = {}, sources = [], meta } = report;
  const titleOf = new Map(sources.map((s) => [s.sourceId, s.title]));
  const actions = (
    <div className="page-actions">
      <button type="button" className="primary" onClick={onNewSearch}>새 검색</button>
    </div>
  );

  // 구조화 응답을 받지 못했으면 본문만 보여 준다. 검증 제한 사실은 배지가 알린다.
  if (meta?.degraded) {
    return (
      <main className="page">
        <QualityBadge quality={meta?.quality} />
        <Section title="CS 기술 동향 브리핑">
          <p className="report-text">{analysis.report}</p>
        </Section>
        <SourceCitation sources={sources} meta={meta} />
        {actions}
      </main>
    );
  }

  const developments = analysis.keyDevelopments ?? [];
  const papers = analysis.paperHighlights ?? [];
  const signals = analysis.openSourceSignals ?? [];

  return (
    <main className="page">
      <QualityBadge quality={meta?.quality} />

      <Section title="핵심 요약">
        <p>{analysis.summary || NO_DATA}</p>
        {analysis.sourceCoverage && (
          <p className="muted small">
            자료 충분도: {analysis.sourceCoverage.level} — {analysis.sourceCoverage.note}
          </p>
        )}
      </Section>

      <Section title="주요 동향">
        {developments.length === 0 ? <Empty /> : developments.map((d, i) => (
          <article key={i} className="dev-card">
            <div className="dev-head">
              <strong>{d.title}</strong>
              <span className="evidence-badge">{d.evidenceLevel}</span>
            </div>
            <Labeled label="새로운 점">{d.whatIsNew}</Labeled>
            <Labeled label="중요한 이유">{d.whyItMatters}</Labeled>
            <Cites ids={d.sourceIds} />
          </article>
        ))}
      </Section>

      <Section title="논문 하이라이트">
        {papers.length === 0 ? <Empty /> : papers.map((p) => (
          <article key={p.sourceId} className="dev-card">
            <div className="dev-head">
              <span className="cite">{p.sourceId}</span>
              <strong>{titleOf.get(p.sourceId) ?? ''}</strong>
            </div>
            <Labeled label="기여">{p.contribution}</Labeled>
            <Labeled label="방법">{p.method}</Labeled>
            <Labeled label="한계">{p.limitations}</Labeled>
            {/* C2(논문 한 편 전문 분석)에서 연결한다. */}
            <button type="button" disabled>전문 분석 (준비 중)</button>
          </article>
        ))}
      </Section>

      <Section title="커뮤니티 반응">
        <p>{analysis.communityPulse || NO_DATA}</p>
      </Section>

      <Section title="오픈소스 신호">
        {signals.length === 0 ? <Empty /> : (
          <ul>
            {signals.map((s) => (
              <li key={s.sourceId}>
                <span className="cite">{s.sourceId}</span> {titleOf.get(s.sourceId) ?? ''} — {s.signal}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="미해결 질문"><TextList items={analysis.openQuestions} /></Section>
      <Section title="지켜볼 것"><TextList items={analysis.whatToWatch} /></Section>

      <SourceCitation sources={sources} meta={meta} />
      {actions}
    </main>
  );
}
