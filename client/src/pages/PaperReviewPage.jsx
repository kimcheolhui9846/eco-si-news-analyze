import { formatUsd } from '../lib/format.js';

const STATUS_LABEL = { partial: '일부만', dropped: '제외' };
const MAX_AUTHORS = 10;

const authorsLine = (authors = []) => {
  if (authors.length === 0) return '저자 미상';
  const shown = authors.slice(0, MAX_AUTHORS).join(', ');
  return authors.length > MAX_AUTHORS ? `${shown} 외 ${authors.length - MAX_AUTHORS}명` : shown;
};

export default function PaperReviewPage({ collected, onApprove, onBack, busy }) {
  if (!collected) return null;
  const { paper, collected: meta, estimate, confirmToken } = collected;
  const outline = meta?.outline ?? [];

  return (
    <main className="page has-sticky">
      <header className="page-head">
        <h1>읽을 논문을 확인해 주세요</h1>
        <button type="button" className="link" onClick={onBack}>검색으로</button>
      </header>

      <section className="card">
        <h2 className="card-title">{paper.title}</h2>
        <p>{authorsLine(paper.authors)}</p>
        <p className="muted small">
          arXiv {paper.id} · <a href={paper.url} target="_blank" rel="noopener noreferrer">arXiv 원문</a>
        </p>
      </section>

      <section className="card">
        <h2 className="card-title">본문 장 ({meta?.sectionCount ?? 0}개 분석)</h2>
        {meta?.truncatedCount > 0 && (
          <p className="banner warn-banner">
            본문이 길어 일부 장은 분석에서 빠지거나 잘립니다. 빠진 장의 내용은 보고서에 반영되지 않습니다.
          </p>
        )}
        <ul className="news-list">
          {outline.map((o) => (
            <li key={o.id} className={`news-item${o.status === 'dropped' ? ' muted' : ''}`}>
              <div className="news-head">
                <span className="cite">{o.id}</span>
                <span className="news-title">{o.heading}</span>
                {STATUS_LABEL[o.status] && <span className="kind">{STATUS_LABEL[o.status]}</span>}
              </div>
              <div className="news-meta">약 {o.tokens.toLocaleString('ko-KR')}토큰</div>
            </li>
          ))}
        </ul>
        <p className="muted small">참고문헌과 부록은 분석에서 제외했습니다.</p>
      </section>

      <div className="sticky-bar">
        <div className="sticky-info">
          <span>
            예상 비용 <strong>{formatUsd(estimate?.estimatedCostUsd)}</strong>
            {estimate?.budget && <> · 오늘 {estimate.budget.calls.used}/{estimate.budget.calls.limit}회 사용</>}
          </span>
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => onApprove({ mode: 'paper', paper, confirmToken })}
        >
          {busy ? '분석 중…' : '분석 시작'}
        </button>
      </div>
    </main>
  );
}
