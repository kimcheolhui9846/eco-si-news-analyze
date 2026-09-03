import { formatDateTime, formatCount } from '../lib/format.js';

const SOURCE_LABEL = {
  explicit: '직접 입력', alias: '별칭 사전', search: '검색', unresolved: '해석 실패',
};

export default function SourceSummary({ collected }) {
  if (!collected) return null;

  return (
    <section className="card">
      <div className="summary-grid">
        <div><strong>{formatCount(collected.newsCount, '건')}</strong><span>수집 자료</span></div>
        <div><strong className="warn">{formatCount(collected.headlineOnlyCount, '건')}</strong><span>제목만</span></div>
        <div><strong>{formatCount(collected.duplicatesRemoved, '건')}</strong><span>중복 제거</span></div>
        <div>
          <strong>{collected.resolvedSymbol ?? '—'}</strong>
          <span>종목 ({SOURCE_LABEL[collected.symbolSource] ?? collected.symbolSource})</span>
        </div>
      </div>

      <p className="muted small">
        기준 시각 {formatDateTime(collected.collectedAt)}
        {collected.feedsUsed?.length > 0 && <> · 사용 피드 {collected.feedsUsed.join(', ')}</>}
      </p>

      {collected.degraded?.length > 0 && (
        <ul className="degraded">
          {collected.degraded.map((d, i) => (
            <li key={`${d.provider}-${i}`}>
              {d.provider === 'market' ? '시장 데이터' : '뉴스'}: {d.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
