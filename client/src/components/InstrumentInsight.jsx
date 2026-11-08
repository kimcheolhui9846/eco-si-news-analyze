/** 분석이 쓴 종목별 비교. 수치 비교표(InstrumentComparison)는 서버 자료이고, 이것은 해석이다. */
export default function InstrumentInsight({ items }) {
  if (!items?.length) return null;
  return (
    <section className="card">
      <h2 className="card-title">종목별 비교 분석</h2>
      <ul className="instrument-insight">
        {items.map((it) => (
          <li key={it.symbol}>
            <div><strong>{it.name}</strong> <span className="muted small">{it.symbol}</span></div>
            <p>{it.positioning}</p>
            <p className="muted">{`핵심 차이: ${it.keyDifference}`}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
