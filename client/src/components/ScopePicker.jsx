// 수집 범위. 서버의 COLLECT_SCOPES와 순서·값이 같아야 한다.
export const INVEST_SCOPES = [
  { value: 'news', label: '뉴스', hint: '항상 포함됩니다', locked: true },
  { value: 'market', label: '시장 차트', hint: '주가·코인 시세와 이동평균' },
  { value: 'financial', label: '재무지표', hint: '미국(SEC)·한국(OpenDART) 상장사' },
  { value: 'research', label: '논문', hint: '초록까지. 표본 수·연구 단계는 제공되지 않음' },
  // 힌트에 '검색어'라는 낱말을 쓰지 않는다. 위쪽 '검색어' 입력 레이블과
  // 겹쳐 화면 낭독기와 테스트 양쪽에서 어느 쪽인지 가려지지 않는다.
  { value: 'experiments', label: '실험·임상', hint: 'ClinicalTrials.gov · 영문 질의에서만 동작' },
];

// CS 수집 범위. 서버의 CS_SCOPES와 순서·값이 같아야 한다.
// 힌트에 '검색어'라는 낱말을 쓰지 않는다(위 INVEST_SCOPES 주석 참고).
export const CS_SCOPES = [
  { value: 'papers', label: '논문', hint: 'arXiv CS 분야 프리프린트 · 영문 질의 권장' },
  { value: 'community', label: '커뮤니티', hint: 'Hacker News·Lobsters 최근 30일 · 영문 질의 권장' },
  { value: 'questions', label: '개발자 질문', hint: 'Stack Overflow 최근 90일 · 투표순 · 영문 질의 권장' },
  { value: 'news', label: '뉴스', hint: '구글 뉴스·연합뉴스·전자신문' },
  { value: 'blogs', label: '기술 블로그', hint: '구글·딥마인드·OpenAI 등 10곳 최근 60일' },
  { value: 'repos', label: '저장소', hint: 'GitHub 최근 30일 갱신 · 스타 순' },
];

export default function ScopePicker({ value, onChange, disabled, scopes = INVEST_SCOPES }) {
  const toggle = (scope) => {
    const next = new Set(value);
    if (next.has(scope)) next.delete(scope);
    else next.add(scope);
    // 잠긴 범위(투자의 뉴스)는 뺄 수 없다. 서버도 강제로 넣으므로 화면이 거짓말하지 않게 맞춘다.
    for (const s of scopes) if (s.locked) next.add(s.value);
    const ordered = scopes.map((s) => s.value).filter((s) => next.has(s));
    // 하나도 고르지 않으면 서버는 전부 수집한다. 화면과 어긋나지 않게 마지막 하나는 남긴다.
    if (ordered.length === 0) return;
    onChange(ordered);
  };

  return (
    <fieldset className="scope-picker">
      <legend>수집 범위</legend>

      {scopes.map((scope) => (
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
