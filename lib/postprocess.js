// ─── 응답 후처리 및 URL 무결성 검증 ───

// URL 끝에 붙은 문장부호는 URL의 일부가 아니다. 괄호·따옴표·대괄호를 경계로 본다.
const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]]+/g;

/**
 * 입력에 없던 URL을 제거한다.
 *
 * 시스템 프롬프트로 "URL을 만들지 말라"고 지시하는 것만으로는 보장되지 않는다.
 * 결정적인 후처리로 강제해야 한다.
 */
export function stripFabricatedUrls(value, whitelist) {
  let removed = 0;

  const walk = (node) => {
    if (typeof node === 'string') {
      return node.replace(URL_PATTERN, (url) => {
        // 끝에 붙은 문장부호를 떼고 대조한다. 떼지 않으면 진짜 출처가 위조로 오판된다.
        const trimmed = url.replace(/[.,;:!?]+$/, '');
        if (whitelist.has(trimmed)) return url;
        removed += 1;
        return '[출처 미확인]';
      });
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };

  return { value: walk(value), removed };
}

/** JSON 객체만 받아들인다. 배열·원시값은 보고서가 아니므로 null로 취급한다. */
export function parseAnalysis(content) {
  if (typeof content !== 'string' || content.trim() === '') return null;

  // 모델이 코드펜스로 감싸는 경우가 있다.
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');

  try {
    const parsed = JSON.parse(unfenced);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 출처 목록은 항상 서버가 입력 자료에서 만든다.
 * LLM 응답 스키마에 sources가 없는 이유다. 관여할 수 없으면 위조할 수도 없다.
 */
export function buildSources(items, collectedAt) {
  return items.map((item) => ({
    sourceId: item.sourceId,
    title: item.title,
    source: item.source,
    url: item.url,
    publishedAt: item.publishedAt,
    collectedAt,
    type: 'news',
    relevance: item.relevance,
  }));
}
