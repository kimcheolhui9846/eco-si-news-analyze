export default function MonitoringIndicators({ indicators }) {
  if (!indicators?.length) return null;

  return (
    <section className="card">
      <h2 className="card-title">모니터링 지표</h2>
      <ul className="bullet">{indicators.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </section>
  );
}
