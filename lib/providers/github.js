import {
  CS_LIMITS, DAY_MS, FETCH_FAILED, clamp, cleanText, httpUrlOrNull, isoOrNull, nonNegInt,
  createCachedSource, jsonArrayField,
} from './cs-common.js';

// ─── GitHub 저장소 검색 ───
//
// 비인증 한도는 분당 10회다. GITHUB_TOKEN이 있으면 한도가 늘어난다.
// 스타 수는 화제성이지 품질의 근거가 아니다.

export const GITHUB_WINDOW_DAYS = 30;
export const GITHUB_LIMIT_REASON = 'GitHub 검색 한도를 넘었습니다.';

export function buildGithubUrl({ query, since, limit }) {
  const params = new URLSearchParams({
    q: `${query} pushed:>${since}`,
    sort: 'stars',
    order: 'desc',
    per_page: String(limit),
  });
  return `https://api.github.com/search/repositories?${params}`;
}

const nullableText = (raw, max) => {
  const text = clamp(cleanText(raw), max);
  return text || null;
};

export function parseGithubSearch(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const items = Array.isArray(data?.items) ? data.items : [];

  return items.map((r) => {
    const url = httpUrlOrNull(r?.html_url);
    // 저장소 링크는 github.com이어야 한다. 다른 호스트는 출처로 믿을 수 없다.
    if (!url || !url.startsWith('https://github.com/')) return null;
    const fullName = clamp(cleanText(r.full_name), CS_LIMITS.fullName);
    if (!fullName) return null;

    const spdx = r.license?.spdx_id;
    return {
      fullName,
      url,
      description: clamp(cleanText(r.description), CS_LIMITS.description),
      stars: nonNegInt(r.stargazers_count),
      language: nullableText(r.language, CS_LIMITS.language),
      // NOASSERTION은 GitHub가 라이선스를 판별하지 못했다는 뜻이다.
      license: spdx && spdx !== 'NOASSERTION' ? clamp(spdx, CS_LIMITS.license) : null,
      pushedAt: isoOrNull(r.pushed_at),
      createdAt: isoOrNull(r.created_at),
    };
  }).filter(Boolean);
}

export function createGithubProvider({ http, cache, clock, makeBreaker, token = '' }) {
  const fetchSource = createCachedSource({
    http, cache, makeBreaker, source: 'GitHub',
    failureReason: (err) => ([403, 429].includes(err?.upstreamStatus) ? GITHUB_LIMIT_REASON : FETCH_FAILED),
  });
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'eco-si-news-analyze',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  return {
    search({ query, limit }) {
      const since = new Date(clock.now() - GITHUB_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
      return fetchSource({
        key: `github:${limit}:${query}`,
        url: buildGithubUrl({ query, since, limit }),
        parse: (text) => {
          jsonArrayField(text, 'items');
          return parseGithubSearch(text).slice(0, limit);
        },
        headers,
      });
    },
  };
}
