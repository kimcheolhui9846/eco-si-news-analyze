import { useState } from 'react';
import QualityBadge from '../components/QualityBadge.jsx';
import SourceCitation from '../components/SourceCitation.jsx';

// 모든 문자열은 텍스트로만 그린다. 모델 출력을 HTML로 해석하지 않는다.

const NO_DATA = '자료 없음';
const SNIPPET_CHARS = 600;

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
const Labeled = ({ label, children }) => (
  <p><span className="muted small">{label}</span> {children}</p>
);

/** 인용 ID 버튼. 누르면 그 장의 제목과 본문 앞부분을 펼친다. */
function Cites({ ids, sectionsById }) {
  const [open, setOpen] = useState(null);
  if (!ids?.length) return <span className="muted small">근거 장 없음</span>;
  const section = open ? sectionsById.get(open) : null;
  return (
    <div className="cites">
      {ids.map((id, i) => (
        <button key={`${id}-${i}`} type="button" className="cite"
          aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
          {id}
        </button>
      ))}
      {section && (
        <blockquote className="cite-snippet">
          <strong>{section.heading}</strong>
          <p className="report-text">
            {section.text.length > SNIPPET_CHARS ? `${section.text.slice(0, SNIPPET_CHARS)}…` : section.text}
          </p>
        </blockquote>
      )}
    </div>
  );
}

export default function PaperReportPage({ report, paper, onNewSearch }) {
  if (!report) return null;
  const { analysis = {}, sources = [], meta } = report;
  const sectionsById = new Map((paper?.sections ?? []).map((s) => [s.id, s]));
  const truncated = meta?.truncated ?? [];
  const title = meta?.paper?.title ?? paper?.title ?? '';

  const actions = (
    <div className="page-actions">
      <button type="button" className="primary" onClick={onNewSearch}>새 검색</button>
    </div>
  );
  const head = (
    <>
      <QualityBadge quality={meta?.quality} />
      <header className="page-head">
        <h1>{title}</h1>
        {paper?.url && (
          <a href={paper.url} target="_blank" rel="noopener noreferrer">arXiv {meta?.paper?.id ?? paper.id}</a>
        )}
      </header>
      {truncated.length > 0 && (
        <p className="banner warn-banner">
          길이 제한으로 분석에서 빠지거나 잘린 장: {truncated.map((t) => (t.partial ? `${t.heading}(일부)` : t.heading)).join(', ')}
        </p>
      )}
    </>
  );

  if (meta?.degraded) {
    return (
      <main className="page">
        {head}
        <Section title="논문 비판적 읽기"><p className="report-text">{analysis.report}</p></Section>
        <SourceCitation sources={sources} meta={meta} />
        {actions}
      </main>
    );
  }

  const cite = (ids) => <Cites ids={ids} sectionsById={sectionsById} />;
  const { problem, method, experimentalSetup: setup, reproducibility: repro } = analysis;
  const results = analysis.keyResults ?? [];
  const limits = analysis.authorStatedLimitations ?? [];
  const concerns = analysis.reviewerConcerns ?? [];
  const listOrDash = (items) => (items?.length ? items.join(', ') : '본문에 없음');

  return (
    <main className="page">
      {head}

      <Section title="핵심 요약"><p>{analysis.summary || NO_DATA}</p></Section>

      <Section title="풀려는 문제">
        {problem ? <><p>{problem.statement}</p>{cite(problem.sourceIds)}</> : <Empty />}
      </Section>

      <Section title="방법">
        {method ? (
          <>
            <p>{method.overview}</p>
            <TextList items={method.keyIdeas} />
            {cite(method.sourceIds)}
          </>
        ) : <Empty />}
      </Section>

      <Section title="실험 설정">
        {setup ? (
          <>
            <Labeled label="데이터셋">{listOrDash(setup.datasets)}</Labeled>
            <Labeled label="비교 대상">{listOrDash(setup.baselines)}</Labeled>
            <Labeled label="평가 지표">{listOrDash(setup.metrics)}</Labeled>
            {cite(setup.sourceIds)}
          </>
        ) : <Empty />}
      </Section>

      <Section title="핵심 결과">
        {results.length === 0 ? <Empty /> : results.map((r, i) => (
          <article key={i} className="dev-card">
            <div className="dev-head"><strong>{r.claim}</strong></div>
            {r.numbers?.length > 0 && (
              <p>{r.numbers.map((n, j) => <mark key={j} className="number">{n}</mark>)}</p>
            )}
            {cite(r.sourceIds)}
          </article>
        ))}
      </Section>

      <Section title="저자가 밝힌 한계">
        {limits.length === 0 ? <p className="muted">본문에 저자가 밝힌 한계가 없습니다.</p> : limits.map((l, i) => (
          <article key={i} className="dev-card"><p>{l.point}</p>{cite(l.sourceIds)}</article>
        ))}
      </Section>

      <Section title="리뷰어 시각의 약점">
        {concerns.length === 0 ? <Empty /> : concerns.map((c, i) => (
          <article key={i} className="dev-card">
            <div className="dev-head">
              <strong>{c.concern}</strong>
              <span className="evidence-badge">{c.severity}</span>
            </div>
            <Labeled label="이유">{c.why}</Labeled>
            {cite(c.sourceIds)}
          </article>
        ))}
      </Section>

      <Section title="재현성">
        {repro ? (
          <>
            <p>코드: {repro.code} · 데이터: {repro.data}</p>
            {repro.note && <p>{repro.note}</p>}
            {cite(repro.sourceIds)}
          </>
        ) : <Empty />}
      </Section>

      <Section title="남은 질문"><TextList items={analysis.openQuestions} /></Section>

      <SourceCitation sources={sources} meta={meta} />
      {actions}
    </main>
  );
}
