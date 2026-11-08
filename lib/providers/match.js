// ─── 검색어 일치 규칙 ───
//
// 부분 문자열로 비교하면 "메타버스"가 "메타"(META)로 잡힌다.
// 단어 단위로 비교하고, 한국어 조사만 꼬리로 허용한다.

export const PARTICLES = ['으로', '에서', '은', '는', '이', '가', '의', '을', '를', '에', '와', '과', '도', '로'];

const SEPARATORS = /[\s,.;:!?()[\]{}"'“”‘’/\\|·~]+/u;

export function tokenize(text) {
  return String(text ?? '').toLowerCase().split(SEPARATORS).filter(Boolean);
}

const tokenMatches = (token, key) =>
  token === key || (token.startsWith(key) && PARTICLES.includes(token.slice(key.length)));

/**
 * 키 목록으로 일치 함수를 만든다. 키 정렬은 한 번만 한다.
 * 반환하는 키는 소문자·trim한 형태다. 호출부의 사전도 같은 형태로 키를 둬야 한다.
 */
export function createMatcher(keys) {
  const entries = [...new Set(keys.map((k) => String(k).toLowerCase().trim()).filter(Boolean))]
    .map((key) => ({ key, parts: tokenize(key) }))
    .filter((e) => e.parts.length > 0)
    .sort((a, b) => b.key.length - a.key.length);

  return (query) => {
    const tokens = tokenize(query);
    for (const { key, parts } of entries) {
      for (let i = 0; i + parts.length <= tokens.length; i += 1) {
        const head = parts.slice(0, -1).every((p, j) => tokens[i + j] === p);
        if (head && tokenMatches(tokens[i + parts.length - 1], parts.at(-1))) return key;
      }
    }
    return null;
  };
}
