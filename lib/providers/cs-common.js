import { stripControlChars } from '../normalize.js';

// ─── CS 수집기 공용부 ───

/**
 * 자료 상한. lib/validation.js의 CS 스키마가 같은 값을 쓴다.
 * provider는 자기 검증기가 받아들이는 범위 안에서만 자료를 만든다.
 */
export const CS_LIMITS = Object.freeze({
  title: 300,
  text: 1500,
  summary: 1500,
  description: 500,
  blog: 100,
  fullName: 200,
  language: 60,
  license: 60,
  category: 40,
  url: 2048,
});

/** 출처별 수집 상한. 분석 스키마의 배열 상한과 같다. */
export const CS_MAX = Object.freeze({ papers: 8, community: 10, news: 8, blogs: 8, repos: 8 });

export const DAY_MS = 86_400_000;
export const FETCH_FAILED = '자료를 가져오지 못했습니다.';
export const BREAKER_OPEN = '일시적으로 사용할 수 없습니다.';

export const clamp = (text, max) => String(text ?? '').slice(0, max);

/** 제어문자·HTML 태그·흔한 엔티티를 걷어 낸 한 줄 텍스트. */
export function cleanText(raw) {
  return stripControlChars(String(raw ?? ''))
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** http(s) URL만 원문 그대로 돌려준다. 검증 스키마의 길이 상한을 넘으면 버린다. */
export function httpUrlOrNull(raw) {
  if (typeof raw !== 'string' || raw.length > CS_LIMITS.url) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? raw : null;
  } catch {
    return null;
  }
}

export function isoOrNull(raw) {
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export const nonNegInt = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);

/**
 * 캐시·회로 차단기가 붙은 단일 소스 호출기.
 * 실패는 예외 대신 degraded로 돌려주고 캐시하지 않는다.
 */
export function createCachedSource({
  http, cache, makeBreaker, source, failureReason = () => FETCH_FAILED,
}) {
  const breaker = makeBreaker();

  return async ({ key, url, parse, headers }) => {
    const cached = cache.get(key);
    if (cached) return { items: cached, degraded: [] };

    if (!breaker.canPass()) return { items: [], degraded: [{ source, reason: BREAKER_OPEN }] };

    try {
      const { text } = await http.get(url, headers ? { headers } : undefined);
      breaker.recordSuccess();
      const items = parse(text);
      cache.set(key, items);
      return { items, degraded: [] };
    } catch (err) {
      breaker.recordFailure();
      // 상류 원본 메시지에는 내부 경로나 토큰이 섞일 수 있다. 담지 않는다.
      return { items: [], degraded: [{ source, reason: failureReason(err) }] };
    }
  };
}
