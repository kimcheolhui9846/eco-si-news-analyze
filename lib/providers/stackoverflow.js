import {
  CS_LIMITS, DAY_MS, FETCH_FAILED, clamp, cleanText, httpUrlOrNull, nonNegInt,
  createCachedSource, jsonArrayField,
} from './cs-common.js';

// ─── Stack Overflow (Stack Exchange API 2.3) ───
//
// 키 없이 IP당 하루 300회, STACKEXCHANGE_KEY가 있으면 하루 10,000회.
// 점수·조회수는 "얼마나 많은 개발자가 막히는가"의 신호이지 정확성의 근거가 아니다.
// 글은 CC BY-SA다. 작성자 이름을 함께 싣는다.

export const SO_WINDOW_DAYS = 90;
export const SO_LIMIT_REASON = 'Stack Overflow 호출 한도를 초과했습니다. 잠시 뒤 다시 시도해 주세요.';

export function buildSoUrl({ query, fromEpochSec, limit, key }) {
  const params = new URLSearchParams({
    order: 'desc',
    sort: 'votes',
    q: query,
    site: 'stackoverflow',
    fromdate: String(fromEpochSec),
    pagesize: String(limit),
    filter: 'withbody',
  });
  if (key) params.set('key', key);
  return `https://api.stackexchange.com/2.3/search/advanced?${params}`;
}

const intOrZero = (n) => (Number.isInteger(n) ? n : 0);

export function parseSoSearch(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const items = Array.isArray(data?.items) ? data.items : [];

  return items.map((q) => {
    const url = httpUrlOrNull(q?.link);
    // 질문 링크는 stackoverflow.com이어야 한다. 다른 호스트는 출처로 믿을 수 없다.
    if (!url || !url.startsWith('https://stackoverflow.com/')) return null;
    const title = clamp(cleanText(q.title), CS_LIMITS.title);
    if (!title || !Number.isInteger(q.creation_date)) return null;

    const tags = (Array.isArray(q.tags) ? q.tags : [])
      .filter((t) => typeof t === 'string' && t)
      .slice(0, CS_LIMITS.tags)
      .map((t) => clamp(t, CS_LIMITS.tag));

    return {
      title,
      url,
      author: clamp(cleanText(q.owner?.display_name), CS_LIMITS.author),
      tags,
      score: intOrZero(q.score),
      answerCount: nonNegInt(q.answer_count),
      isAnswered: q.is_answered === true,
      hasAcceptedAnswer: q.accepted_answer_id != null,
      viewCount: nonNegInt(q.view_count),
      publishedAt: new Date(q.creation_date * 1000).toISOString(),
      text: clamp(cleanText(q.body), CS_LIMITS.text),
    };
  }).filter(Boolean);
}

export function createStackOverflowProvider({ http, cache, clock, makeBreaker, key = '' }) {
  const fetchSource = createCachedSource({
    http, cache, makeBreaker, source: 'Stack Overflow',
    // lib/http.js는 오류 본문을 버리고 상태 코드만 남긴다. SE는 한도 초과를 400(throttle_violation)으로 준다.
    failureReason: (err) => ([400, 429].includes(err?.upstreamStatus) ? SO_LIMIT_REASON : FETCH_FAILED),
  });

  return {
    search({ query, limit }) {
      const fromEpochSec = Math.floor(clock.now() / 1000) - SO_WINDOW_DAYS * (DAY_MS / 1000);
      return fetchSource({
        // 키는 캐시 키에 넣지 않는다. 결과는 키와 무관하다.
        key: `so:${limit}:${query}`,
        url: buildSoUrl({ query, fromEpochSec, limit, key }),
        parse: (text) => {
          jsonArrayField(text, 'items');
          return parseSoSearch(text).slice(0, limit);
        },
      });
    },
  };
}
