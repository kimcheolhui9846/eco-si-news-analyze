import { formatDateTime, formatCount } from '../lib/format.js';

// degraded의 provider 이름표. 없으면 재무·논문·실험이 모두 '뉴스'로 둔갑한다.
const PROVIDER_LABEL = {
  news: '뉴스', market: '시장 데이터', financial: '재무지표',
  research: '논문', experiments: '실험·임상',
};

const RESOLUTION_LABEL = {
  explicit: '직접 입력', company: '회사', sector: '분야 묶음', unresolved: '해석 실패',
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
          <strong>
            {collected.resolution?.kind === 'sector'
              ? `${collected.resolution.sector} ${collected.resolution.symbols.length}종목`
              : collected.resolution?.symbols?.[0] ?? '—'}
          </strong>
          <span>종목 ({RESOLUTION_LABEL[collected.resolution?.kind] ?? '—'})</span>
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
              {PROVIDER_LABEL[d.provider] ?? d.provider}{d.symbol ? ` (${d.symbol})` : ''}: {d.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
