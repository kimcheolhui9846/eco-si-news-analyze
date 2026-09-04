import { emptySectionMessage } from '../lib/dataSection.js';

const formatValue = (metric) => {
  const n = Number(metric.value);
  // 주당순이익은 소수점이 의미가 있다. 나머지는 정수 자리로 충분하다.
  const text = Math.abs(n) < 1000
    ? n.toLocaleString('ko-KR')
    : Math.round(n).toLocaleString('ko-KR');
  return `${text} ${metric.unit}`;
};

const basisOf = (metric) => [
  metric.fiscalYear ? `FY${metric.fiscalYear}${metric.fiscalPeriod ? ` ${metric.fiscalPeriod}` : ''}` : null,
  metric.form,
  metric.filed ? `${metric.filed} 제출` : null,
].filter(Boolean).join(' · ');

export default function FinancialMetrics({ financial, collected }) {
  const empty = !financial || financial.metrics.length === 0;

  return (
    <section className="card">
      <h2 className="card-title">기업 재무지표</h2>

      {empty ? (
        <p className="muted small">{emptySectionMessage('financial', collected)}</p>
      ) : (
        <>
          <p className="muted small">
            {financial.entityName ?? financial.symbol} · SEC EDGAR
          </p>

          <table className="metrics">
            <tbody>
              {financial.metrics.map((m) => (
                <tr key={m.concept}>
                  <th scope="row">{m.label}</th>
                  <td>{formatValue(m)}</td>
                  {/* 기준 기간을 값에서 떼면 어느 분기 숫자인지 잃어버린다. */}
                  <td className="muted small">{basisOf(m)}</td>
                </tr>
              ))}
              {financial.derived.map((d) => (
                <tr key={d.label}>
                  <th scope="row">{d.label} <span className="badge">계산값</span></th>
                  <td>{d.value}{d.unit}</td>
                  <td className="muted small">{d.formula} · {d.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {financial.degraded.length > 0 && (
            <ul className="degraded">
              {financial.degraded.map((d) => (
                <li key={d.concept}>{d.concept}: {d.reason}</li>
              ))}
            </ul>
          )}

          {financial.filingUrl && (
            <p className="small">
              <a href={financial.filingUrl} target="_blank" rel="noreferrer noopener">
                제출 서류 보기
              </a>
            </p>
          )}
        </>
      )}
    </section>
  );
}
