// ─── 언어 가드 ───
//
// 한국어 검색어를 영어 논문 DB에 넣으면 0건이 아니라 무관한 실존 논문이
// 돌아온다. URL도 논문도 실재하므로 위조 URL 제거에도, '자료 부족' 판정에도
// 걸리지 않는다. 결과를 걸러낼 신뢰할 기준이 없으므로 요청을 보내지 않는다.

/** 한글 음절 영역. 자모(ㄱ, ㅏ)만 있는 질의는 검색어로 성립하지 않아 제외한다. */
const HANGUL = /[가-힣]/;

export function hasHangul(query) {
  return HANGUL.test(String(query ?? ''));
}

export function routeForQuery(query) {
  if (hasHangul(query)) {
    return {
      route: 'ko',
      useEnglishPapers: false,
      useKci: true,
      useTrials: false,
      reason: '한국어 검색어입니다. 해외 논문 DB와 임상시험 자료는 영어 검색어에서만 동작하므로 호출하지 않았습니다.',
    };
  }
  return {
    route: 'en',
    useEnglishPapers: true,
    useKci: false,
    useTrials: true,
    reason: '영어 검색어입니다. 국내 논문(KCI)은 한국어 검색어에서만 조회합니다.',
  };
}
