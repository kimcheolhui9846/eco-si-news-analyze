import {
  CS_LIMITS, DAY_MS, clamp, cleanText, httpUrlOrNull, isoOrNull, nonNegInt, createCachedSource,
} from './cs-common.js';

// ─── Hacker News (Algolia 검색 API) ───
//
// 키가 필요 없다. 점수·댓글 수는 화제성이지 정확성이 아니다.

export const HN_WINDOW_DAYS = 30;

export function buildHnUrl({ query, sinceEpochSec, limit }) {
  const params = new URLSearchParams({
    query,
    tags: 'story',
    numericFilters: `created_at_i>${sinceEpochSec}`,
    hitsPerPage: String(limit),
  });
  return `https://hn.algolia.com/api/v1/search?${params}`;
}

export function parseHnSearch(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const hits = Array.isArray(data?.hits) ? data.hits : [];

  return hits.map((h) => {
    const id = String(h?.objectID ?? '');
    // 토론 링크를 만드는 값이다. 숫자가 아니면 링크를 신뢰할 수 없다.
    if (!/^\d+$/.test(id)) return null;

    const title = clamp(cleanText(h.title), CS_LIMITS.title);
    const publishedAt = isoOrNull(h.created_at);
    if (!title || !publishedAt) return null;

    const discussionUrl = `https://news.ycombinator.com/item?id=${id}`;
    return {
      title,
      // Ask HN처럼 링크가 없는 글은 토론 페이지가 원문이다.
      url: httpUrlOrNull(h.url) ?? discussionUrl,
      discussionUrl,
      points: nonNegInt(h.points),
      numComments: nonNegInt(h.num_comments),
      publishedAt,
      text: clamp(cleanText(h.story_text), CS_LIMITS.text),
    };
  }).filter(Boolean);
}

export function createHackerNewsProvider({ http, cache, clock, makeBreaker }) {
  const fetchSource = createCachedSource({ http, cache, makeBreaker, source: 'Hacker News' });

  return {
    search({ query, limit }) {
      const sinceEpochSec = Math.floor(clock.now() / 1000) - HN_WINDOW_DAYS * (DAY_MS / 1000);
      return fetchSource({
        key: `hn:${limit}:${query}`,
        url: buildHnUrl({ query, sinceEpochSec, limit }),
        parse: (text) => parseHnSearch(text).slice(0, limit),
      });
    },
  };
}
