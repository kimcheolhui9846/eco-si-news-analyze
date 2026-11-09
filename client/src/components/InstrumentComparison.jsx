const LABELS = ['매출', '영업이익', '순이익'];

/** 큰 금액을 조·억으로 줄인다. 통화는 바꾸지 않는다. */
export function compactNumber(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
  if (a >= 1e8) return `${Math.round(v / 1e8).toLocaleString('ko-KR')}억`;
  return v.toLocaleString('ko-KR');
}

const metricCell = (financial, label) => {
  const m = financial?.metrics.find((x) => x.label === label);
  return m ? `${compactNumber(m.value)} ${m.unit}` : '—';
};

export default function InstrumentComparison({ instruments, resolution, degraded = [] }) {
  if (!instruments?.length) return null;
  const reasonsFor = (symbol) => degraded.filter((d) => d.symbol === symbol).map((d) => d.reason);

  return (
    <section className="card">
      <h2 className="card-title">
        {resolution?.sector ? `${resolution.sector} 분야 대표 종목 ${instruments.length}개` : `종목 ${instruments.length}개`}
      </h2>
      <p className="muted small">통화는 종목별 원래 단위입니다. 환산하지 않았습니다.</p>
      <div className="table-scroll">
        <table className="metrics comparison">
          <thead>
            <tr>
              <th scope="col">종목</th>
              <th scope="col">현재가</th>
              <th scope="col">변동률</th>
              {LABELS.map((l) => <th scope="col" key={l}>{l}</th>)}
              <th scope="col">비고</th>
            </tr>
          </thead>
          <tbody>
            {instruments.map((inst) => (
              <tr key={inst.symbol}>
                <th scope="row"><span>{inst.name}</span> <span className="muted small">{inst.symbol}</span></th>
                <td>{inst.marketData?.currentPrice ?? '—'}</td>
                <td>{inst.marketData?.priceChange ?? '—'}</td>
                {LABELS.map((l) => <td key={l}>{metricCell(inst.financial, l)}</td>)}
                <td className="muted small">
                  {inst.assetType === 'crypto' && <span>재무 해당 없음</span>}
                  {reasonsFor(inst.symbol).map((r) => <span key={r}>{r}</span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
