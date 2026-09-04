import { emptySectionMessage } from '../lib/dataSection.js';

/** 목표치를 실제 등록 수처럼 보이게 하면 연구 규모를 오해한다. */
function enrollmentLabel(item) {
  if (item.enrollmentCount === null || item.enrollmentCount === undefined) {
    return '표본 수 자료 부족';
  }
  const kind = item.enrollmentType === 'ESTIMATED' ? '모집 목표' : '실제 등록';
  return `${item.enrollmentCount.toLocaleString('ko-KR')}명 (${kind})`;
}

export default function ExperimentStatus({ items, collected }) {
  return (
    <section className="card">
      <h2 className="card-title">실험·임상 자료</h2>

      {!items || items.length === 0 ? (
        <p className="muted small">{emptySectionMessage('experiments', collected)}</p>
      ) : (
        <ul className="trial-list">
          {items.map((item) => (
            <li key={item.nctId} className="trial-item">
              <div className="trial-head">
                {item.phase && <span className="badge">{item.phase}</span>}
                <span className="muted small">{item.status}</span>
                {item.hasResults
                  ? <span className="badge ok">결과 등록됨</span>
                  : <span className="badge">결과 등록 안 됨</span>}
              </div>

              <h3 className="trial-title">
                {item.url
                  ? <a href={item.url} target="_blank" rel="noreferrer noopener">{item.title}</a>
                  : item.title}
              </h3>

              <p className="muted small">
                {item.organization ?? '수행기관 확인 불가'} · {enrollmentLabel(item)}
                {item.startDate && <> · 시작 {item.startDate}</>}
              </p>

              {item.conditions?.length > 0 && (
                <p className="small">대상: {item.conditions.join(', ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
