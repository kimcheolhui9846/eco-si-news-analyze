const SEVERITY_LABEL = { fixed: '교정됨', warning: '확인 필요' };

/** 서버의 결정적 품질 검사 결과. 메시지는 서버가 만든 문장이며 모델 출력 원문이 아니다. */
export default function QualityBadge({ quality }) {
  if (!quality) return null;
  const { score, fixed, warnings, issues = [], limited } = quality;

  if (issues.length === 0) {
    return (
      <section className="card quality-badge" aria-label="자동 검증 결과">
        <p className="quality-line">자동 검증 통과</p>
      </section>
    );
  }

  return (
    <section className="card quality-badge" aria-label="자동 검증 결과">
      <details>
        <summary className="quality-line">
          {`검증 ${score}점 · 교정 ${fixed}건 · 경고 ${warnings}건`}
          {limited && <span className="muted small"> (검증 제한)</span>}
        </summary>
        <ul className="quality-issues">
          {issues.map((it, i) => (
            <li key={`${it.check}-${i}`} className={`quality-issue ${it.severity}`}>
              <span className="quality-tag">{SEVERITY_LABEL[it.severity] ?? '확인 필요'}</span>
              <span>{it.message}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
