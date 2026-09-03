import { formatDateTime } from '../lib/format.js';

export default function SourceCitation({ sources, meta }) {
  if (!sources?.length) return null;

  return (
    <section className="card">
      <h2 className="card-title">출처 ({sources.length}건)</h2>

      {/* 서버가 위조 URL을 제거했다면 그 사실을 사용자가 알아야 한다. */}
      {meta?.fabricatedUrlsRemoved > 0 && (
        <p className="warn small">
          출처에 없는 링크 {meta.fabricatedUrlsRemoved}개를 보고서에서 제거했습니다.
        </p>
      )}

      <ol className="sources">
        {sources.map((s) => (
          <li key={s.sourceId}>
            <span className="cite">{s.sourceId}</span>
            <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
            <span className="muted small">
              {' '}· {s.source} · 작성 {formatDateTime(s.publishedAt)} · 수집 {formatDateTime(s.collectedAt)}
            </span>
          </li>
        ))}
      </ol>

      {meta?.collectedAt && (
        <p className="muted small">데이터 기준 시각: {formatDateTime(meta.collectedAt)}</p>
      )}
    </section>
  );
}
