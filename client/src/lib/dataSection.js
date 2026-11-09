/**
 * 빈 섹션에 적을 문구.
 *
 * 자료가 없는 것과 못 가져온 것은 완전히 다른 정보다. 감추면 사용자는
 * 그 자료가 존재하지 않는다고 오해한다.
 *
 * 문구는 서버가 만든다. 화면에서 다시 쓰면 두 곳이 어긋난다.
 */
export function emptySectionMessage(provider, collected) {
  if (!collected) return '자료를 불러오지 못했습니다.';

  const reasons = (collected.degraded ?? [])
    .filter((d) => d.provider === provider)
    .map((d) => d.reason)
    .filter(Boolean);

  const parts = [];
  if (!(collected.included ?? []).includes(provider)) {
    parts.push('이번 요청에서 선택하지 않은 자료입니다.');
  } else if (reasons.length === 0) {
    parts.push('검색 결과가 없습니다.');
  }

  parts.push(...reasons);

  // 한국어 질의로 소스가 통째로 생략된 경우 그 사실을 함께 적는다.
  // 재무는 언어와 무관하게 종목 해석 결과로만 갈린다.
  if (collected.languageRoute?.route === 'ko' && provider !== 'financial') {
    parts.push(collected.languageRoute.reason);
  }

  return [...new Set(parts)].join(' ');
}
