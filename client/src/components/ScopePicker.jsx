// 수집 범위. 서버의 COLLECT_SCOPES와 순서·값이 같아야 한다.
const SCOPES = [
  { value: 'news', label: '뉴스', hint: '항상 포함됩니다', locked: true },
  { value: 'market', label: '시장 차트', hint: '주가·코인 시세와 이동평균' },
  { value: 'financial', label: '재무지표', hint: '미국(SEC)·한국(OpenDART) 상장사' },
  { value: 'research', label: '논문', hint: '초록까지. 표본 수·연구 단계는 제공되지 않음' },
  // 힌트에 '검색어'라는 낱말을 쓰지 않는다. 위쪽 '검색어' 입력 레이블과
  // 겹쳐 화면 낭독기와 테스트 양쪽에서 어느 쪽인지 가려지지 않는다.
  { value: 'experiments', label: '실험·임상', hint: 'ClinicalTrials.gov · 영문 질의에서만 동작' },
];

export default function ScopePicker({ value, onChange, disabled }) {
  const toggle = (scope) => {
    const next = new Set(value);
    if (next.has(scope)) next.delete(scope);
    else next.add(scope);
    // 뉴스는 뺄 수 없다. 서버도 강제로 넣으므로 화면이 거짓말하지 않게 맞춘다.
    next.add('news');
    onChange(SCOPES.map((s) => s.value).filter((s) => next.has(s)));
  };

  return (
    <fieldset className="scope-picker">
      <legend>수집 범위</legend>

      {SCOPES.map((scope) => (
        <label key={scope.value} className="scope-row">
          <input
            type="checkbox"
            checked={scope.locked || value.includes(scope.value)}
            disabled={disabled || scope.locked}
            onChange={() => toggle(scope.value)}
          />
          <span className="scope-label">{scope.label}</span>
          <span className="muted small">{scope.hint}</span>
        </label>
      ))}

      {/* 고르는 자리에서 알려야 승인 전에 판단할 수 있다. */}
      <p className="muted small">
        범위를 넓히면 프롬프트가 커져 <strong>예상 비용</strong>이 올라갑니다.
        정확한 금액은 다음 화면에서 승인 전에 표시됩니다.
      </p>
    </fieldset>
  );
}
