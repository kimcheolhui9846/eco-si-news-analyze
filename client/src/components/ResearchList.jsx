import { emptySectionMessage } from '../lib/dataSection.js';

const PEER_BADGE = {
  'peer-reviewed': { label: '동료 심사', className: 'badge ok' },
  preprint: { label: '프리프린트', className: 'badge warn' },
  unknown: { label: '검증 미확인', className: 'badge' },
};

/** 연도만 아는 발표일을 일자처럼 보이게 하지 않는다. */
function publishedLabel(item) {
  if (!item.publishedAt) return '발표일 확인 불가';
  const iso = String(item.publishedAt).slice(0, 10);
  if (item.datePrecision === 'year') return `${iso.slice(0, 4)}년`;
  if (item.datePrecision === 'month') return iso.slice(0, 7);
  return iso;
}

export default function ResearchList({ items, collected }) {
  return (
    <section className="card">
      <h2 className="card-title">논문 및 연구 자료</h2>

      {!items || items.length === 0 ? (
        <p className="muted small">{emptySectionMessage('research', collected)}</p>
      ) : (
        <ul className="research-list">
          {items.map((item) => {
            const badge = PEER_BADGE[item.peerReviewed] ?? PEER_BADGE.unknown;
            return (
              <li key={item.url ?? item.title} className="research-item">
                <div className="research-head">
                  <span className={badge.className}>{badge.label}</span>
                  <span className="muted small">{item.sourceName}</span>
                </div>

                <h3 className="research-title">
                  {item.url
                    ? <a href={item.url} target="_blank" rel="noreferrer noopener">{item.title}</a>
                    : item.title}
                </h3>

                <p className="muted small">
                  {publishedLabel(item)}
                  {item.venue && <> · {item.venue}</>}
                  {item.authors?.length > 0 && <> · {item.authors.slice(0, 3).join(', ')}</>}
                </p>

                {item.abstract
                  ? (
                    <p className="small">
                      {item.abstract.slice(0, 400)}{item.abstract.length > 400 ? '…' : ''}
                    </p>
                  )
                  : <p className="muted small">초록이 제공되지 않았습니다.</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
