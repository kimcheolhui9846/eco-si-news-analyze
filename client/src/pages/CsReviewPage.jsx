import NewsList from '../components/NewsList.jsx';
import { formatDateTime, formatUsd } from '../lib/format.js';

const PROVIDER_LABEL = {
  papers: '논문', community: '커뮤니티', questions: '개발자 질문', news: '뉴스', blogs: '기술 블로그', repos: '저장소',
};

const ExternalLink = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
);

function Group({ title, items, children }) {
  return (
    <section className="card">
      <h2 className="card-title">{title} ({items.length}건)</h2>
      {items.length === 0
        ? <p className="muted">자료가 없습니다.</p>
        : <ul className="news-list">{children}</ul>}
    </section>
  );
}

const authorsLine = (p) => {
  const rest = p.authorCount - p.authors.length;
  return `${p.authors.join(', ')}${rest > 0 ? ` 외 ${rest}명` : ''}`;
};

export default function CsReviewPage({ collected, onApprove, onBack, busy }) {
  if (!collected) return null;

  const {
    newsList = [], papers = [], community = [], questions = [], blogs = [], repos = [],
    collected: meta, estimate, confirmToken,
  } = collected;
  const included = meta?.included ?? Object.keys(PROVIDER_LABEL);
  const shown = (scope) => included.includes(scope);

  return (
    <main className="page has-sticky">
      <header className="page-head">
        <h1>수집한 자료를 확인해 주세요</h1>
        <button type="button" className="link" onClick={onBack}>검색으로</button>
      </header>

      <section className="card">
        <h2 className="card-title">수집 요약</h2>
        <p>
          합계 {meta?.total ?? 0}건 · 논문 {papers.length} · 커뮤니티 {community.length} · 질문 {questions.length} ·
          {' '}뉴스 {newsList.length} · 블로그 {blogs.length} · 저장소 {repos.length}
        </p>
        {/* 비어 있는 이유를 승인 전에 알아야 한다. */}
        {meta?.degraded?.length > 0 && (
          <ul className="muted small">
            {meta.degraded.map((d, i) => (
              <li key={i}>
                {PROVIDER_LABEL[d.provider] ?? d.provider}
                {(d.source ?? d.feedId) ? ` · ${d.source ?? d.feedId}` : ''}: {d.reason}
              </li>
            ))}
          </ul>
        )}
      </section>

      {shown('papers') && (
        <Group title="논문 (arXiv 프리프린트)" items={papers}>
          {papers.map((p) => (
            <li key={p.url ?? p.title} className="news-item">
              <div className="news-head">
                <span className="news-title">{p.title}</span>
                <span className="kind">{p.category ?? 'arXiv'}</span>
              </div>
              <div className="news-meta">
                {authorsLine(p)} · {formatDateTime(p.publishedAt)}
                {p.url && <> · <ExternalLink href={p.url}>원문</ExternalLink></>}
              </div>
              {p.abstract && <p className="news-body">{p.abstract}</p>}
            </li>
          ))}
        </Group>
      )}

      {shown('community') && (
        <Group title="커뮤니티 (Hacker News·Lobsters)" items={community}>
          {community.map((h) => (
            <li key={h.discussionUrl} className="news-item">
              <div className="news-head">
                <span className="news-title">{h.title}</span>
                <span className="kind">{h.site === 'lobsters' ? 'Lobsters' : 'HN'}</span>
              </div>
              <div className="news-meta">
                점수 {h.points} · 댓글 {h.numComments} · {formatDateTime(h.publishedAt)} ·
                {' '}<ExternalLink href={h.discussionUrl}>토론</ExternalLink>
              </div>
              {h.text && <p className="news-body">{h.text}</p>}
            </li>
          ))}
        </Group>
      )}

      {shown('questions') && (
        <Group title="개발자 질문 (Stack Overflow)" items={questions}>
          {questions.map((q) => (
            <li key={q.url} className="news-item">
              <div className="news-head"><span className="news-title">{q.title}</span></div>
              <div className="news-meta">
                {`점수 ${q.score} · 답변 ${q.answerCount} · ${q.hasAcceptedAnswer ? '채택 답변 있음' : (q.isAnswered ? '답변 있음' : '답 없음')} · 조회 ${q.viewCount} ·`}
                {' '}{formatDateTime(q.publishedAt)} · <ExternalLink href={q.url}>질문</ExternalLink>
              </div>
              {q.tags.length > 0 && <div className="muted small">{q.tags.join(' · ')}</div>}
              <div className="muted small">작성자 {q.author || '미상'} · CC BY-SA</div>
              {q.text && <p className="news-body">{q.text}</p>}
            </li>
          ))}
        </Group>
      )}

      {shown('news') && (
        <section className="card">
          <h2 className="card-title">뉴스 ({newsList.length}건)</h2>
          <NewsList items={newsList} />
        </section>
      )}

      {shown('blogs') && (
        <Group title="기술 블로그" items={blogs}>
          {blogs.map((b) => (
            <li key={b.url} className="news-item">
              <div className="news-head"><span className="news-title">{b.title}</span></div>
              <div className="news-meta">
                {b.blog} · {formatDateTime(b.publishedAt)} · <ExternalLink href={b.url}>원문</ExternalLink>
              </div>
              {b.summary && <p className="news-body">{b.summary}</p>}
            </li>
          ))}
        </Group>
      )}

      {shown('repos') && (
        <Group title="저장소 (GitHub)" items={repos}>
          {repos.map((g) => (
            <li key={g.url} className="news-item">
              <div className="news-head"><span className="news-title">{g.fullName}</span></div>
              <div className="news-meta">
                스타 {g.stars} · {g.language ?? '언어 미상'} · {g.license ?? '라이선스 미상'} ·
                {' '}갱신 {formatDateTime(g.pushedAt)} · <ExternalLink href={g.url}>저장소</ExternalLink>
              </div>
              {g.description && <p className="news-body">{g.description}</p>}
            </li>
          ))}
        </Group>
      )}

      <div className="sticky-bar">
        <div className="sticky-info">
          <span>
            예상 비용 <strong>{formatUsd(estimate?.estimatedCostUsd)}</strong>
            {estimate?.budget && (
              <> · 오늘 {estimate.budget.calls.used}/{estimate.budget.calls.limit}회 사용</>
            )}
          </span>
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => onApprove({
            mode: 'cs', newsList, papers, community, questions, blogs, repos, confirmToken,
          })}
        >
          {busy ? '분석 중…' : '분석 시작'}
        </button>
      </div>
    </main>
  );
}
