import {
  CS_LIMITS, DAY_MS, clamp, cleanText, httpUrlOrNull, isoOrNull, nonNegInt,
  createCachedSource, MalformedUpstream,
} from './cs-common.js';
import { createTtlCache } from '../cost-defense.js';
import { HN_WINDOW_DAYS } from './hackernews.js';

// ─── Lobsters ───
//
// 검색 JSON이 없다. 질의를 태그로 바꿔 태그 피드를 읽고, 맞는 태그가 없으면 최신 글에서 거른다.
// 점수·댓글 수는 화제성이지 정확성이 아니다.

const BASE = 'https://lobste.rs';
const MAX_TAGS = 2;
const TAGS_TTL_MS = DAY_MS;

/** 흔한 표현 → Lobsters 태그. 태그 목록에 실제로 있을 때만 쓴다. */
export const LOBSTERS_TAG_ALIASES = Object.freeze({
  llm: 'ai', llms: 'ai', rag: 'ai', gpt: 'ai', transformer: 'ai', transformers: 'ai',
  'machine learning': 'ai', 'deep learning': 'ai', ml: 'ai', agent: 'ai', agents: 'ai',
  database: 'databases', db: 'databases', sql: 'databases',
  golang: 'go',
  js: 'javascript', typescript: 'javascript', node: 'nodejs', 'node.js': 'nodejs',
  k8s: 'devops', kubernetes: 'devops', docker: 'devops',
  crypto: 'cryptography',
});

// 주제 태그가 아닌 분류. 질의 단어와 우연히 겹쳐도 고르지 않는다.
const NON_TOPICAL_CATEGORIES = new Set(['format', 'genre', 'culture', 'lobsters']);

const words = (query) => String(query).toLowerCase().split(/[^a-z0-9+#.-]+/).filter(Boolean);

export function pickLobstersTags(query, tagNames) {
  const available = new Set(tagNames);
  const ws = words(query);
  const picked = [];
  const add = (tag) => {
    if (tag && available.has(tag) && !picked.includes(tag)) picked.push(tag);
  };
  for (let i = 0; i < ws.length; i += 1) {
    // 두 단어 별칭("machine learning")을 먼저 본다.
    const pair = ws[i + 1] ? `${ws[i]} ${ws[i + 1]}` : null;
    if (pair && LOBSTERS_TAG_ALIASES[pair]) {
      add(LOBSTERS_TAG_ALIASES[pair]);
      i += 1;
      continue;
    }
    add(available.has(ws[i]) ? ws[i] : LOBSTERS_TAG_ALIASES[ws[i]]);
  }
  return picked.slice(0, MAX_TAGS);
}

export function parseLobstersStories(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  return data.map((s) => {
    // 토론 링크를 만드는 값이다. 형식이 다르면 링크를 신뢰할 수 없다.
    if (!/^[a-z0-9]+$/.test(String(s?.short_id ?? ''))) return null;
    const discussionUrl = httpUrlOrNull(s.comments_url);
    if (!discussionUrl || !discussionUrl.startsWith(`${BASE}/s/${s.short_id}`)) return null;
    const title = clamp(cleanText(s.title), CS_LIMITS.title);
    const publishedAt = isoOrNull(s.created_at);
    if (!title || !publishedAt) return null;

    return {
      site: 'lobsters',
      title,
      // 링크가 없는 글은 토론 페이지가 원문이다.
      url: httpUrlOrNull(s.url) ?? discussionUrl,
      discussionUrl,
      points: nonNegInt(s.score),
      numComments: nonNegInt(s.comment_count),
      publishedAt,
      text: clamp(cleanText(s.description_plain), CS_LIMITS.text),
      tags: Array.isArray(s.tags) ? s.tags.filter((t) => typeof t === 'string') : [],
    };
  }).filter(Boolean);
}

/** 제목은 통단어(영숫자 경계)로, 태그는 완전 일치로 질의 단어를 찾는다. */
const matchesKeyword = (story, keyword) => {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(story.title)
    || story.tags.some((t) => t.toLowerCase() === keyword);
};

/** 본문이 JSON 배열이 아니면(차단 안내 HTML 등) 실패로 다룬다. */
const jsonArray = (text) => {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new MalformedUpstream('not json');
  }
  if (!Array.isArray(data)) throw new MalformedUpstream('not array');
};

export function createLobstersProvider({
  http, cache, clock, makeBreaker,
  // 태그 목록은 하루 붙잡아 둔다. CS 공용 캐시와 TTL이 달라 따로 둔다.
  tagCache = createTtlCache({ ttlMs: TAGS_TTL_MS, maxEntries: 1, clock }),
}) {
  const fetchStories = createCachedSource({ http, cache, makeBreaker, source: 'Lobsters' });
  const fetchTags = createCachedSource({ http, cache: tagCache, makeBreaker, source: 'Lobsters tags' });

  const tagNames = async () => {
    const { items } = await fetchTags({
      key: 'lobsters:tags',
      url: `${BASE}/tags.json`,
      parse: (text) => {
        jsonArray(text);
        return JSON.parse(text).filter((t) => t?.active && typeof t.tag === 'string' && !NON_TOPICAL_CATEGORIES.has(t.category)).map((t) => t.tag);
      },
    });
    // 실패해도 알리지 않는다. 최신 글로 대체한다.
    return items;
  };

  const stories = (path) => fetchStories({
    key: `lobsters:${path}`,
    url: `${BASE}${path}`,
    parse: (text) => {
      jsonArray(text);
      return parseLobstersStories(text);
    },
  });

  return {
    async search({ query, limit }) {
      const since = clock.now() - HN_WINDOW_DAYS * DAY_MS;
      const tags = pickLobstersTags(query, await tagNames());

      const keywords = words(query).filter((w) => w.length >= 3);
      const hits = (s) => keywords.some((k) => matchesKeyword(s, k));
      let items = [];
      const degraded = [];
      if (tags.length > 0) {
        const results = await Promise.all(tags.map((t) => stories(`/t/${t}.json`)));
        for (const r of results) {
          items.push(...r.items);
          degraded.push(...r.degraded);
        }
      } else {
        const r = await stories('/newest.json');
        degraded.push(...r.degraded);
        items = r.items.filter(hits);
      }

      const seen = new Set();
      const picked = items
        .filter((s) => Date.parse(s.publishedAt) >= since)
        .filter((s) => (seen.has(s.discussionUrl) ? false : seen.add(s.discussionUrl)))
        .sort((a, b) => (hits(b) - hits(a)) || (b.points - a.points))
        .slice(0, limit)
        // tags는 거르기에만 쓴다. 커뮤니티 공통 모양에 없는 필드다.
        .map(({ tags: _tags, ...rest }) => rest);

      // 같은 사유가 태그마다 반복되면 하나로 합친다.
      const uniqueDegraded = [...new Map(degraded.map((d) => [`${d.source}:${d.reason}`, d])).values()];
      return { items: picked, degraded: uniqueDegraded };
    },
  };
}
