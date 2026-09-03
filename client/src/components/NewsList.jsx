import { formatDateTime } from '../lib/format.js';

const KIND_LABEL = { headline: '제목만', summary: '요약', full: '전문' };

export default function NewsList({ items }) {
  if (!items?.length) return <p className="muted">자료가 없습니다.</p>;

  return (
    <ul className="news-list">
      {items.map((item) => (
        <li key={item.url} className="news-item">
          <div className="news-head">
            <span className="news-title">{item.title}</span>
            <span className={`kind kind-${item.contentKind ?? 'full'}`}>
              {KIND_LABEL[item.contentKind] ?? KIND_LABEL.full}
            </span>
          </div>
          <div className="news-meta">
            {item.source} · {formatDateTime(item.publishedAt)} ·{' '}
            <a href={item.url} target="_blank" rel="noopener noreferrer">원문</a>
          </div>
          {item.contentKind !== 'headline' && <p className="news-body">{item.content}</p>}
        </li>
      ))}
    </ul>
  );
}
