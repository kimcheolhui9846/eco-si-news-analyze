export default function RiskPanel({ risks }) {
  if (!risks?.length) return null;

  return (
    <section className="card">
      <h2 className="card-title">주의 사항</h2>
      <ul className="bullet">{risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
    </section>
  );
}
